import { initDataRaw, restoreInitData } from "@telegram-apps/sdk-react";
import type { EntryCategory } from "@planer/shared";
import {
  mockArchiveEmployee,
  mockCreateEmployee,
  mockCreateEntry,
  mockDeleteEntry,
  mockGetEmployees,
  mockGetEvents,
  mockGetTeamSchedule,
  mockGetTemplates,
  mockRestoreEmployee,
} from "./mock";

/** A worker row in the schedule grid / Работники screen. */
export interface Employee {
  id: number;
  displayName: string;
  isAdmin: boolean;
  /** false once archived (see `archiveEmployee`). */
  isActive: boolean;
  /** null until the worker opens the invite link and links their Telegram account. */
  telegramUserId: number | null;
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

/** A recent activity item for the "События" feed. */
export interface FeedEvent {
  id: number;
  kind: "success" | "pending" | "error" | "info";
  /** Plain text with `**bold**` spans around actor names (rendered by `EventsFeed`). */
  text: string;
  /** Human-readable relative/absolute time, e.g. "2 часа назад". */
  timeLabel: string;
}

export interface CreateEmployeeResult {
  employee: Employee;
  /** Single-use token embedded in the invite deep-link. */
  inviteToken: string;
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
  getEvents(): Promise<FeedEvent[]>;
  createEntry(input: NewEntryInput): Promise<Shift>;
  deleteEntry(id: number): Promise<void>;
  createEmployee(name: string): Promise<CreateEmployeeResult>;
  archiveEmployee(id: number): Promise<void>;
  restoreEmployee(id: number): Promise<void>;
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

interface EventsResponse {
  events: FeedEvent[];
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

  async getEvents() {
    // NOTE: `/api/admin/events` doesn't exist on the server yet — there is no
    // activity log to read from. Tracked as a follow-up alongside the
    // employee-management endpoints below; dev uses mock data in the meantime.
    const { events } = await authorizedGet<EventsResponse>("/api/admin/events");
    return events;
  },

  async createEntry(input) {
    const { entry } = await authorizedPostJson<{ entry: Shift }>("/api/admin/entries", input);
    return entry;
  },

  async deleteEntry(id) {
    await authorizedDelete(`/api/admin/entries/${id}`);
  },

  // NOTE: none of the three employee-management endpoints below exist on the
  // server yet. `GET /api/admin/employees` is real (server/src/http/app.ts),
  // but creating an employee (+ generating an invite deep-link) and
  // archiving/restoring one are not wired up — only the repo-level helpers
  // exist (server/src/repo/employees.ts: createEmployee, archiveEmployee,
  // restoreEmployee). Tracked as a follow-up; these calls are shaped for once
  // that lands. Until then, only `devClient` (mock, below) is exercised.
  async createEmployee(name) {
    return authorizedPostJson<CreateEmployeeResult>("/api/admin/employees", { displayName: name });
  },

  async archiveEmployee(id) {
    await authorizedPostJson(`/api/admin/employees/${id}/archive`, {});
  },

  async restoreEmployee(id) {
    await authorizedPostJson(`/api/admin/employees/${id}/restore`, {});
  },
};

const devClient: ApiClient = {
  getEmployees: () => mockGetEmployees(),
  getTeamSchedule: (from, to) => mockGetTeamSchedule(from, to),
  getTemplates: () => mockGetTemplates(),
  getEvents: () => mockGetEvents(),
  createEntry: (input) => mockCreateEntry(input),
  deleteEntry: (id) => mockDeleteEntry(id),
  createEmployee: (name) => mockCreateEmployee(name),
  archiveEmployee: (id) => mockArchiveEmployee(id),
  restoreEmployee: (id) => mockRestoreEmployee(id),
};

/**
 * In dev, short-circuits to realistic mock data so the app renders with no
 * backend running. In production, authenticates via Telegram initData and
 * talks to the real API at `VITE_API_BASE`.
 */
export const apiClient: ApiClient = import.meta.env.DEV ? devClient : realClient;
