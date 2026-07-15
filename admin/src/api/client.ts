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
  mockSetEmployeeAdmin,
  mockRenameEmployee,
  mockGetEmployeeInvite,
  mockGetWeekendSlots,
  mockPostSlot,
  mockAssignSlot,
  mockGetPayroll,
  mockGetPayrollCsv,
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
  /** Which kind of entry this preset creates — default "shift"; e.g. the Поклонка preset is a "duty". */
  category: EntryCategory;
  /** Default place for duty/offsite presets, null for plain shifts. */
  location: string | null;
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
  /** Ready-made `https://t.me/<bot>?start=<token>` deep-link, or `null` if the server has no bot username configured. */
  inviteLink: string | null;
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

export type WeekendSlotStatus = "open" | "assigned" | "closed";

/** A vacant weekend/holiday slot opened for volunteers. */
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

/** One interested worker for a slot, with their confirmed-this-month count driving the fairness hint. */
export interface SlotInterest {
  employeeId: number;
  name: string;
  confirmedThisMonth: number;
}

/** An open slot plus its interested workers, already ranked fairest-first by the server. */
export interface AdminSlotView {
  slot: VacantSlot;
  interested: SlotInterest[];
}

export interface NewSlotInput {
  date: string;
  start: string;
  end: string;
  title?: string;
  location?: string;
  note?: string;
}

/** One confirmed weekend-work record for payroll. */
export interface PayrollRow {
  employeeId: number;
  employeeName: string;
  date: string;
  hours: number;
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
  setEmployeeAdmin(id: number, isAdmin: boolean): Promise<void>;
  renameEmployee(id: number, displayName: string): Promise<void>;
  /** (Re)issue the invite link for a worker who hasn't linked Telegram yet. */
  getEmployeeInvite(id: number, regenerate?: boolean): Promise<{ inviteToken: string; inviteLink: string | null }>;
  getWeekendSlots(): Promise<AdminSlotView[]>;
  postSlot(input: NewSlotInput): Promise<VacantSlot>;
  assignSlot(slotId: number, employeeId: number): Promise<void>;
  getPayroll(from: string, to: string): Promise<PayrollRow[]>;
  getPayrollCsv(from: string, to: string): Promise<string>;
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

/** Raw shape of a `GET /api/admin/events` row — an audit-log entry, not yet
 * formatted for the "События" feed (see `toFeedEvent` below). */
interface RawAdminEvent {
  id: number;
  type: string;
  createdAt: string;
  actorName: string | null;
  payload: unknown;
}

interface EventsResponse {
  events: RawAdminEvent[];
}

/** Payload shape for the `"swap_done"` audit type (see `server/src/swap/swap-service.ts`). */
interface SwapDonePayload {
  fromEmployeeId: number;
  toEmployeeId: number;
}

function isSwapDonePayload(payload: unknown): payload is SwapDonePayload {
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return typeof p.fromEmployeeId === "number" && typeof p.toEmployeeId === "number";
}

/** 1/2/5-style Russian plural picker, e.g. `pluralRu(3, "час", "часа", "часов")` -> "часа". */
function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** "5 минут назад" / "3 часа назад" / "вчера, 18:40" / "3 дня назад" / "14 июля", relative to now. */
function formatRelativeRu(iso: string): string {
  const then = new Date(iso);
  const diffMin = Math.floor((Date.now() - then.getTime()) / 60_000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} ${pluralRu(diffMin, "минуту", "минуты", "минут")} назад`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} ${pluralRu(diffHours, "час", "часа", "часов")} назад`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return `вчера, ${then.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  if (diffDays < 7) return `${diffDays} ${pluralRu(diffDays, "день", "дня", "дней")} назад`;
  return then.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

/** Formats a raw audit-log row into the "События" feed shape, resolving employee names via `namesById`. */
function toFeedEvent(raw: RawAdminEvent, namesById: ReadonlyMap<number, string>): FeedEvent {
  const timeLabel = formatRelativeRu(raw.createdAt);
  if (raw.type === "swap_done" && isSwapDonePayload(raw.payload)) {
    const fromName = namesById.get(raw.payload.fromEmployeeId) ?? "Коллега";
    const toName = namesById.get(raw.payload.toEmployeeId) ?? "Коллега";
    return { id: raw.id, kind: "success", text: `**${fromName}** ⇄ **${toName}** — обмен состоялся`, timeLabel };
  }
  const actor = raw.actorName ?? "Кто-то";
  return { id: raw.id, kind: "info", text: `**${actor}** — событие: ${raw.type}`, timeLabel };
}

const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";

/** Thrown when the console has no valid session — the UI shows a login prompt. */
export class AuthRequiredError extends Error {}

const ADMIN_TOKEN_KEY = "adminToken";

/**
 * Two ways to sign into the console:
 *  - **Browser**: the bot's /admin command hands out a link ending in
 *    `#token=<jwt>`; we stash it in localStorage and strip it from the URL.
 *  - **Inside Telegram**: fall back to validating Telegram initData.
 */
function captureHashToken(): void {
  if (typeof location === "undefined") return;
  const m = location.hash.match(/token=([^&]+)/);
  if (!m) return;
  try {
    localStorage.setItem(ADMIN_TOKEN_KEY, decodeURIComponent(m[1]!));
  } catch {
    /* localStorage unavailable (private mode) — token just won't persist */
  }
  // Don't leave the JWT sitting in the address bar / history.
  history.replaceState(null, "", location.pathname + location.search);
}
captureHashToken();

function storedToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Drops the cached session so the next call re-authenticates (or prompts login). */
function clearAuth(): void {
  tokenPromise = null;
  try {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

let tokenPromise: Promise<string> | null = null;

async function requestToken(): Promise<string> {
  const browserToken = storedToken();
  if (browserToken) return browserToken;

  let initData = "";
  try {
    restoreInitData();
    initData = initDataRaw() ?? "";
  } catch {
    // No launch params (opened in a plain browser without a login link).
  }
  if (!initData) {
    throw new AuthRequiredError("Требуется вход");
  }
  const res = await fetch(`${API_BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData }),
  });
  if (!res.ok) {
    throw new AuthRequiredError(`Auth failed with status ${res.status}`);
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

/** Maps a failed response to an error, turning 401 into a session-expired `AuthRequiredError`. */
async function toError(path: string, res: Response): Promise<Error> {
  if (res.status === 401 || res.status === 403) {
    clearAuth();
    return new AuthRequiredError("Сессия истекла — войди заново");
  }
  return new Error(await errorMessage(path, res));
}

async function authorizedGet<T>(path: string): Promise<T> {
  const token = await authToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw await toError(path, res);
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
    throw await toError(path, res);
  }
  return (await res.json()) as T;
}

async function authorizedPatchJson<T>(path: string, payload: unknown): Promise<T> {
  const token = await authToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await toError(path, res);
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
    throw await toError(path, res);
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
    const [{ events }, { employees }] = await Promise.all([
      authorizedGet<EventsResponse>("/api/admin/events"),
      authorizedGet<EmployeesResponse>("/api/admin/employees"),
    ]);
    const namesById = new Map(employees.map((e) => [e.id, e.displayName]));
    return events.map((raw) => toFeedEvent(raw, namesById));
  },

  async createEntry(input) {
    const { entry } = await authorizedPostJson<{ entry: Shift }>("/api/admin/entries", input);
    return entry;
  },

  async deleteEntry(id) {
    await authorizedDelete(`/api/admin/entries/${id}`);
  },

  async createEmployee(name) {
    return authorizedPostJson<CreateEmployeeResult>("/api/admin/employees", { displayName: name });
  },

  async archiveEmployee(id) {
    await authorizedPostJson(`/api/admin/employees/${id}/archive`, {});
  },

  async restoreEmployee(id) {
    await authorizedPostJson(`/api/admin/employees/${id}/restore`, {});
  },

  async setEmployeeAdmin(id, isAdmin) {
    await authorizedPostJson(`/api/admin/employees/${id}/role`, { isAdmin });
  },

  async renameEmployee(id, displayName) {
    await authorizedPatchJson(`/api/admin/employees/${id}`, { displayName });
  },

  getEmployeeInvite(id, regenerate = false) {
    return authorizedPostJson<{ inviteToken: string; inviteLink: string | null }>(`/api/admin/employees/${id}/invite`, { regenerate });
  },

  async getWeekendSlots() {
    const { slots } = await authorizedGet<{ slots: AdminSlotView[] }>("/api/admin/weekend/slots");
    return slots;
  },

  async postSlot(input) {
    const { slot } = await authorizedPostJson<{ slot: VacantSlot }>("/api/admin/weekend/slots", input);
    return slot;
  },

  async assignSlot(slotId, employeeId) {
    await authorizedPostJson(`/api/admin/weekend/slots/${slotId}/assign`, { employeeId });
  },

  async getPayroll(from, to) {
    const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const { rows } = await authorizedGet<{ rows: PayrollRow[] }>(`/api/admin/weekend/payroll?${q}`);
    return rows;
  },

  async getPayrollCsv(from, to) {
    const token = await authToken();
    const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await fetch(`${API_BASE}/api/admin/weekend/payroll.csv?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw await toError("/api/admin/weekend/payroll.csv", res);
    return res.text();
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
  setEmployeeAdmin: (id, isAdmin) => mockSetEmployeeAdmin(id, isAdmin),
  renameEmployee: (id, displayName) => mockRenameEmployee(id, displayName),
  getEmployeeInvite: (id, regenerate) => mockGetEmployeeInvite(id, regenerate),
  getWeekendSlots: () => mockGetWeekendSlots(),
  postSlot: (input) => mockPostSlot(input),
  assignSlot: (slotId, employeeId) => mockAssignSlot(slotId, employeeId),
  getPayroll: (from, to) => mockGetPayroll(from, to),
  getPayrollCsv: (from, to) => mockGetPayrollCsv(from, to),
};

/**
 * In dev, short-circuits to realistic mock data so the app renders with no
 * backend running. In production, authenticates via Telegram initData and
 * talks to the real API at `VITE_API_BASE`.
 */
export const apiClient: ApiClient = import.meta.env.DEV ? devClient : realClient;
