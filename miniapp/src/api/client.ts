import { initDataRaw, restoreInitData } from "@telegram-apps/sdk-react";
import type { Category } from "../categories";
import { mockGetMe, mockGetMyShifts, mockGetTeamSchedule } from "./mock";

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

export interface ApiClient {
  getMe(): Promise<Me>;
  getMyShifts(from: string): Promise<Shift[]>;
  getTeamSchedule(from: string, to: string): Promise<Shift[]>;
}

interface ShiftsResponse {
  shifts: Shift[];
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

const realClient: ApiClient = {
  getMe: () => authorizedGet<Me>("/api/me"),

  async getMyShifts(from) {
    const { shifts } = await authorizedGet<ShiftsResponse>(`/api/my/shifts?from=${encodeURIComponent(from)}`);
    return shifts;
  },

  async getTeamSchedule(from, to) {
    const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const { shifts } = await authorizedGet<ShiftsResponse>(`/api/team/schedule?${query}`);
    return shifts;
  },
};

const devClient: ApiClient = {
  getMe: () => mockGetMe(),
  getMyShifts: (from) => mockGetMyShifts(from),
  getTeamSchedule: (from, to) => mockGetTeamSchedule(from, to),
};

/**
 * In dev, short-circuits to realistic mock data so the app renders with no
 * backend running. In production, authenticates via Telegram initData and
 * talks to the real API at `VITE_API_BASE`.
 */
export const apiClient: ApiClient = import.meta.env.DEV ? devClient : realClient;
