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
  mockGetWeekendSlots,
  mockExpressInterest,
  mockGetWeekendOffers,
  mockConfirmOffer,
  mockDeclineOffer,
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
   * Not part of the raw `/api/team/schedule` row — the real client joins it
   * in from `/api/employees` (id -> displayName) after fetching the shifts.
   * Only `getTeamSchedule` populates this; `getMyShifts` leaves it
   * `undefined` (every row already belongs to the caller).
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
  title: string | null;
}

/**
 * A swap request enriched for display: shift times and the counterparty's
 * name, framed from the current user's point of view (`yourShift` /
 * `theirShift`) regardless of who initiated it.
 *
 * `GET /api/swaps` returns exactly this enriched shape server-side (it joins
 * shifts + employees). `yourShift`/`theirShift` are `null` only in the edge
 * case where the referenced shift row was deleted after the swap was created.
 */
export interface SwapRequest {
  id: number;
  direction: SwapDirection;
  status: SwapStatus;
  message: string | null;
  createdAt: string;
  counterpartyName: string;
  /** The shift the current user gives up in this swap. */
  yourShift: SwapShiftSummary | null;
  /** The shift the current user receives in exchange. */
  theirShift: SwapShiftSummary | null;
}

export type WeekendSlotStatus = "open" | "assigned" | "closed";

/** A vacant weekend/holiday slot an admin opened for volunteers. */
export interface VacantSlot {
  id: number;
  date: string;
  start: string;
  end: string;
  title: string | null;
  location: string | null;
  note: string | null;
  status: WeekendSlotStatus;
}

/** An open slot plus whether the current user already raised their hand for it. */
export interface WeekendSlotView {
  slot: VacantSlot;
  interested: boolean;
}

export type WeekendOfferStatus = "offered" | "confirmed" | "declined";

/** A weekend-work offer addressed to the current user: the slot, and the assignment's state. */
export interface WeekendOffer {
  assignment: { id: number; status: WeekendOfferStatus; hours: number };
  slot: VacantSlot;
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
  getWeekendSlots(): Promise<WeekendSlotView[]>;
  expressInterest(slotId: number): Promise<void>;
  getWeekendOffers(): Promise<WeekendOffer[]>;
  confirmOffer(id: number): Promise<void>;
  declineOffer(id: number): Promise<void>;
}

interface ShiftsResponse {
  shifts: Shift[];
}

interface EmployeesResponse {
  employees: { id: number; displayName: string }[];
}

/** Exact shape of a `GET /api/swaps` row (server-enriched). `counterpartyName`
 * can be `null` if the counterparty employee row is gone; the client falls
 * back to a generic label so the UI's non-nullable `counterpartyName` holds. */
interface RawEnrichedSwap {
  id: number;
  status: SwapStatus;
  message: string | null;
  createdAt: string;
  direction: SwapDirection;
  counterpartyName: string | null;
  yourShift: SwapShiftSummary | null;
  theirShift: SwapShiftSummary | null;
}

interface SwapsResponse {
  swaps: RawEnrichedSwap[];
}

/** `POST /api/swaps` only echoes back the raw inserted row; the id is all this client needs from it. */
interface CreateSwapResponse {
  request: { id: number };
}

function toSwapRequest(raw: RawEnrichedSwap): SwapRequest {
  return {
    id: raw.id,
    direction: raw.direction,
    status: raw.status,
    message: raw.message,
    createdAt: raw.createdAt,
    counterpartyName: raw.counterpartyName ?? "Коллега",
    yourShift: raw.yourShift,
    theirShift: raw.theirShift,
  };
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

/** Fetches and maps `GET /api/swaps` to the enriched UI shape. Shared by
 * `getSwaps` and `proposeSwap` (the latter re-fetches to get the freshly
 * created request's enriched view, since `POST /api/swaps` only echoes the raw row). */
async function fetchSwaps(): Promise<SwapRequest[]> {
  const { swaps } = await authorizedGet<SwapsResponse>("/api/swaps");
  return swaps.map(toSwapRequest);
}

const realClient: ApiClient = {
  getMe: () => authorizedGet<Me>("/api/me"),

  async getMyShifts(from) {
    const { shifts } = await authorizedGet<ShiftsResponse>(`/api/my/shifts?from=${encodeURIComponent(from)}`);
    return shifts;
  },

  async getTeamSchedule(from, to) {
    const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const [{ shifts }, { employees }] = await Promise.all([
      authorizedGet<ShiftsResponse>(`/api/team/schedule?${query}`),
      authorizedGet<EmployeesResponse>("/api/employees"),
    ]);
    const nameById = new Map(employees.map((e) => [e.id, e.displayName]));
    return shifts.map((s) => ({
      ...s,
      employeeName: s.employeeId != null ? nameById.get(s.employeeId) : undefined,
    }));
  },

  getSwaps: () => fetchSwaps(),

  async proposeSwap(fromShiftId, toShiftId, message) {
    const { request } = await authorizedPostJson<CreateSwapResponse>("/api/swaps", {
      fromShiftId,
      toShiftId,
      message,
    });
    const swaps = await fetchSwaps();
    const created = swaps.find((s) => s.id === request.id);
    if (!created) throw new Error("Created swap request not found in /api/swaps response");
    return created;
  },

  acceptSwap: (id) => authorizedPostAction(`/api/swaps/${id}/accept`),
  declineSwap: (id) => authorizedPostAction(`/api/swaps/${id}/decline`),
  cancelSwap: (id) => authorizedPostAction(`/api/swaps/${id}/cancel`),

  async getWeekendSlots() {
    const { slots } = await authorizedGet<{ slots: WeekendSlotView[] }>("/api/weekend/slots");
    return slots;
  },
  expressInterest: (slotId) => authorizedPostAction(`/api/weekend/slots/${slotId}/interest`),
  async getWeekendOffers() {
    const { offers } = await authorizedGet<{ offers: WeekendOffer[] }>("/api/weekend/offers");
    return offers;
  },
  confirmOffer: (id) => authorizedPostAction(`/api/weekend/offers/${id}/confirm`),
  declineOffer: (id) => authorizedPostAction(`/api/weekend/offers/${id}/decline`),
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
  getWeekendSlots: () => mockGetWeekendSlots(),
  expressInterest: (slotId) => mockExpressInterest(slotId),
  getWeekendOffers: () => mockGetWeekendOffers(),
  confirmOffer: (id) => mockConfirmOffer(id),
  declineOffer: (id) => mockDeclineOffer(id),
};

/**
 * In dev, short-circuits to realistic mock data so the app renders with no
 * backend running. In production, authenticates via Telegram initData and
 * talks to the real API at `VITE_API_BASE`.
 */
export const apiClient: ApiClient = import.meta.env.DEV ? devClient : realClient;
