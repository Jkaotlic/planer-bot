import { initDataRaw, restoreInitData } from "@telegram-apps/sdk-react";
import type { EntryCategory } from "@planer/shared";
import {
  mockCreateEntry,
  mockDeleteEntry,
  mockGetEmployees,
  mockGetTeamSchedule,
  mockGetTemplates,
} from "./mock";

/** A worker row in the schedule grid. */
export interface Employee {
  id: number;
  displayName: string;
  isAdmin: boolean;
  isActive: boolean;
}

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
  category: EntryCategory;
  title: string | null;
  employeeId: number | null;
}

/** A saved preset the add-panel can offer, with Friday-shortened times. */
export interface Template {
  id: number;
  name: string;
  start: string;
  end: string;
  fridayStart: string;
  fridayEnd: string;
  isLate: boolean;
  sendReminder: boolean;
}

export interface NewEntryInput {
  date: string;
  category: EntryCategory;
  start?: string;
  end?: string;
  endDate?: string;
  templateId?: number;
  employeeId?: number;
  location?: string;
  title?: string;
}

export interface ApiClient {
  getEmployees(): Promise<Employee[]>;
  getTeamSchedule(from: string, to: string): Promise<Shift[]>;
  getTemplates(): Promise<Template[]>;
  createEntry(input: NewEntryInput): Promise<Shift>;
  deleteEntry(id: number): Promise<void>;
}

interface EmployeesResponse {
  employees: Employee[];
}

interface ShiftsResponse {
  shifts: Shift[];
}

interface TemplatesResponse {
  templates: Template[];
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

/** Reads `{error}` off a non-2xx JSON response, falling back to a generic message. */
async function errorMessage(path: string, res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `Request to ${path} failed with status ${res.status}`;
}

async function authorizedGet<T>(path: string): Promise<T> {
  const token = await authToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await errorMessage(path, res));
  }
  return (await res.json()) as T;
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

async function authorizedDelete(path: string): Promise<void> {
  const token = await authToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await errorMessage(path, res));
  }
}

const realClient: ApiClient = {
  async getEmployees() {
    const { employees } = await authorizedGet<EmployeesResponse>("/api/admin/employees");
    return employees;
  },

  async getTeamSchedule(from, to) {
    const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const { shifts } = await authorizedGet<ShiftsResponse>(`/api/team/schedule?${query}`);
    return shifts;
  },

  async getTemplates() {
    const { templates } = await authorizedGet<TemplatesResponse>("/api/templates");
    return templates;
  },

  async createEntry(input) {
    const { entry } = await authorizedPostJson<{ entry: Shift }>("/api/admin/entries", input);
    return entry;
  },

  async deleteEntry(id) {
    await authorizedDelete(`/api/admin/entries/${id}`);
  },
};

const devClient: ApiClient = {
  getEmployees: () => mockGetEmployees(),
  getTeamSchedule: (from, to) => mockGetTeamSchedule(from, to),
  getTemplates: () => mockGetTemplates(),
  createEntry: (input) => mockCreateEntry(input),
  deleteEntry: (id) => mockDeleteEntry(id),
};

/**
 * In dev, short-circuits to realistic mock data so the app renders with no
 * backend running. In production, authenticates via Telegram initData and
 * talks to the real API at `VITE_API_BASE`.
 */
export const apiClient: ApiClient = import.meta.env.DEV ? devClient : realClient;
