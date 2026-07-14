import { initDataRaw, restoreInitData } from "@telegram-apps/sdk-react";
import type { Category } from "../categories";
import {
  mockAcceptSwap,
  mockCancelSwap,
  mockDeclineSwap,
  mockGetMe,
  mockGetMyShifts,
  mockGetSwaps,
  mockGetTeamSchedule,
  mockProposeSwap,
} from "./mock";

/** A single scheduled entry: a work shift, duty, or a (possibly multi-day) absence. */
export interface Shift {
  id: number;
  /** "YYYY-MM-DD"; for absences, the first day of the span. */
  date: string;
  /** "HH:MM", or null for absences (vacation / business trip) which have no clock times. */
  start: string | null;
  end: string | null;
  /** Last day of the span for multi-day absences; null for single-day entries. */
  endDate: string | null;
  category: Category;
  title: string | null;
  employeeId: number | null;
  /**
   * Not part of the real `/api/team/schedule` response yet — the server is
   * expected to add it later. The dev mock fills it in today so the
   * Команда screen can render names now; the real client leaves it
   * `undefined` until the backend catches up.
   */
  employeeName?: string;
}

export interface Me {
  id: number;
  displayName: string;
  isAdmin: boolean;
}

export type SwapStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

/** Which side of the swap the current user is on. */
export type SwapDirection = "incoming" | "outgoing";

/** Just enough of a shift to render in a swap card — no id, since the two
 * sides of a swap request always resolve back to their own `Shift` via
 * `fromShiftId`/`toShiftId` on the server; the UI only needs to *display* them. */
export interface SwapShiftSummary {
  date: string;
  start: string | null;
  end: string | null;
}

/**
 * A swap request enriched for display: shift times and the counterparty's
 * name, framed from the current user's point of view (`yourShift` /
 * `theirShift`) regardless of who initiated it.
 *
 * NOTE: the real `GET /api/swaps` endpoint returns bare rows today —
 * `{id, fromEmployeeId, fromShiftId, toEmployeeId, toShiftId, status,
 * message, createdAt, resolvedAt}`, no shift times or names. Enriching that
 * server-side (join shifts + employees) is tracked as a follow-up and not
 * done here; the dev mock fabricates the enriched shape directly below, and
 * `realClient.getSwaps` does a best-effort map that leaves `yourShift` /
 * `theirShift` / `counterpartyName` blank until the backend catches up.
 */
export interface SwapRequest {
  id: number;
  direction: SwapDirection;
  status: SwapStatus;
  message: string | null;
  createdAt: string;
  resolvedAt: string | null;
  counterpartyName: string;
  /** The shift the current user gives up in this swap. */
  yourShift: SwapShiftSummary;
  /** The shift the current user receives in exchange. */
  theirShift: SwapShiftSummary;
}

export interface ApiClient {
  getMe(): Promise<Me>;
  getMyShifts(from: string): Promise<Shift[]>;
  getTeamSchedule(from: string, to: string): Promise<Shift[]>;
  getSwaps(): Promise<SwapRequest[]>;
  proposeSwap(fromShiftId: number, toShiftId: number, message?: string): Promise<SwapRequest>;
  acceptSwap(id: number): Promise<void>;
  declineSwap(id: number): Promise<void>;
  cancelSwap(id: number): Promise<void>;
}

interface ShiftsResponse {
  shifts: Shift[];
}

/** Raw shape of a swap row as `/api/swaps` actually returns it today (see the `SwapRequest` doc comment above). */
interface RawSwapRequest {
  id: number;
  fromEmployeeId: number;
  fromShiftId: number;
  toEmployeeId: number;
  toShiftId: number;
  status: SwapStatus;
  message: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface SwapsResponse {
  swaps: RawSwapRequest[];
}

const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";

let tokenPromise: Promise<string> | null = null;

async function requestToken(): Promise<string> {
  try {
    restoreInitData();
  } catch {
    // No launch params available (e.g. opened outside Telegram). Fall
    // through and let the /api/auth call below fail with a clear 401
    // rather than hanging on a signal that will never populate.
  }
  const res = await fetch(`${API_BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData: initDataRaw() ?? "" }),
  });
  if (!res.ok) {
    throw new Error(`Auth failed with status ${res.status}`);
  }
  const body = (await res.json()) as { token: string };
  return body.token;
}

/** Fetches (and caches) the session JWT, authenticating exactly once. */
function authToken(): Promise<string> {
  tokenPromise ??= requestToken();
  return tokenPromise;
}

async function authorizedGet<T>(path: string): Promise<T> {
  const token = await authToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Request to ${path} failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Reads `{error}` off a non-2xx JSON response, falling back to a generic message. */
async function errorMessage(path: string, res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `Request to ${path} failed with status ${res.status}`;
}

async function authorizedPostJson<T>(path: string, payload: unknown): Promise<T> {
  const token = await authToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(path, res));
  }
  return (await res.json()) as T;
}

/** A `{ok: true}`-shaped POST with no body (accept/decline/cancel). */
async function authorizedPostAction(path: string): Promise<void> {
  const token = await authToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await errorMessage(path, res));
  }
}

/** Caches the caller's own id (from `getMe`) so `getSwaps`/`proposeSwap` can
 * tell "your shift" from "their shift" without an extra round trip. */
let cachedMeId: number | null = null;

/**
 * Best-effort mapping from the raw `/api/swaps` row to the enriched shape the
 * UI needs. Until the backend enriches this endpoint (see the `SwapRequest`
 * doc comment in this file), shift times and the counterparty's name aren't
 * available here, so they're left as empty placeholders.
 */
function rawSwapToEnriched(raw: RawSwapRequest, meId: number | null): SwapRequest {
  const direction: SwapDirection = raw.fromEmployeeId === meId ? "outgoing" : "incoming";
  const unknownShift: SwapShiftSummary = { date: "", start: null, end: null };
  return {
    id: raw.id,
    direction,
    status: raw.status,
    message: raw.message,
    createdAt: raw.createdAt,
    resolvedAt: raw.resolvedAt,
    counterpartyName: "Коллега",
    yourShift: unknownShift,
    theirShift: unknownShift,
  };
}

const realClient: ApiClient = {
  async getMe() {
    const me = await authorizedGet<Me>("/api/me");
    cachedMeId = me.id;
    return me;
  },

  async getMyShifts(from) {
    const { shifts } = await authorizedGet<ShiftsResponse>(`/api/my/shifts?from=${encodeURIComponent(from)}`);
    return shifts;
  },

  async getTeamSchedule(from, to) {
    const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const { shifts } = await authorizedGet<ShiftsResponse>(`/api/team/schedule?${query}`);
    return shifts;
  },

  async getSwaps() {
    const { swaps } = await authorizedGet<SwapsResponse>("/api/swaps");
    return swaps.map((raw) => rawSwapToEnriched(raw, cachedMeId));
  },

  async proposeSwap(fromShiftId, toShiftId, message) {
    const { request } = await authorizedPostJson<{ request: RawSwapRequest }>("/api/swaps", {
      fromShiftId,
      toShiftId,
      message,
    });
    return rawSwapToEnriched(request, cachedMeId);
  },

  acceptSwap: (id) => authorizedPostAction(`/api/swaps/${id}/accept`),
  declineSwap: (id) => authorizedPostAction(`/api/swaps/${id}/decline`),
  cancelSwap: (id) => authorizedPostAction(`/api/swaps/${id}/cancel`),
};

const devClient: ApiClient = {
  getMe: () => mockGetMe(),
  getMyShifts: (from) => mockGetMyShifts(from),
  getTeamSchedule: (from, to) => mockGetTeamSchedule(from, to),
  getSwaps: () => mockGetSwaps(),
  proposeSwap: (fromShiftId, toShiftId, message) => mockProposeSwap(fromShiftId, toShiftId, message),
  acceptSwap: (id) => mockAcceptSwap(id),
  declineSwap: (id) => mockDeclineSwap(id),
  cancelSwap: (id) => mockCancelSwap(id),
};

/**
 * In dev, short-circuits to realistic mock data so the app renders with no
 * backend running. In production, authenticates via Telegram initData and
 * talks to the real API at `VITE_API_BASE`.
 */
export const apiClient: ApiClient = import.meta.env.DEV ? devClient : realClient;
