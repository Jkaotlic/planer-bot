import { initDataRaw, restoreInitData } from "@telegram-apps/sdk-react";
import type { EntryCategory, TemplateAccent } from "@planer/shared";
import {
  mockArchiveEmployee,
  mockCreateEmployee,
  mockCreateEntry,
  mockUpdateEntry,
  mockDeleteEntry,
  mockGetEmployees,
  mockGetEvents,
  mockGetTeamSchedule,
  mockGetTemplates,
  mockRestoreEmployee,
  mockSetEmployeeAdmin,
  mockRenameEmployee,
  mockSetBirthDate,
  mockReorderEmployee,
  mockGetEmployeeInvite,
  mockGetWeekendSlots,
  mockPostSlot,
  mockAssignSlot,
  mockUnassignSlot,
  mockGetPayroll,
  mockGetPayrollCsv,
  mockGetRosterCsv,
  mockGetShiftCounts,
  mockGetShiftCountsCsv,
  mockGetJournal,
  mockGetBirthdays,
  mockSaveBirthdayCampaign,
  mockGetBirthdayPreview,
  mockSendBirthday,
  mockGetTemplateRoles,
  mockGetTemplateQueue,
  mockSetRotationUnit,
  mockSaveTemplateRoles,
  mockPreviewRosterImport,
  mockApplyRosterImport,
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
  /** «MM-DD» — day and month of their birthday, or null if not given. */
  birthDate: string | null;
  /** What the bot will actually call them — computed server-side by `addressOf`.
   *  Never derive this from `displayName`: the roster is «Фамилия Имя», so its
   *  first word is a surname. See `addressOf` in @planer/shared. */
  address: string;
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
  /** Set only when a roster import could not read this cell: the original text,
   *  e.g. «Ко». Such an entry has no preset and no times, and draws as «?». */
  unrecognisedCode?: string | null;
  /** The preset this entry came from, if any — drives its colour in the grid. */
  templateId: number | null;
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
  /** Colour slot so each preset reads apart in the schedule. */
  accent: TemplateAccent;
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
  /** `null` clears the stored title (e.g. switching a preset shift to custom times). */
  title?: string | null;
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
  /** Times they volunteered for a slot that went to someone else — breaks ties in their favour. */
  passedOver: number;
  /** Отпуск/больничный/командировка, накрывающие день слота, или null. Пометка, а
   *  не запрет: назначить можно, но админ должен это видеть. */
  absence: EntryCategory | null;
}


/** Someone already put on a slot (a slot can need several people). */
export interface SlotAssignee {
  assignmentId: number;
  employeeId: number;
  name: string;
  status: "offered" | "confirmed";
}

/** An open slot plus its interested workers (ranked fairest-first) and who's already on it. */
export interface AdminSlotView {
  slot: VacantSlot;
  interested: SlotInterest[];
  assignees: SlotAssignee[];
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

export interface RosterImportPerson {
  csvName: string;
  suggestedEmployeeId: number | null;
}

export interface RosterUnknownCell {
  name: string;
  date: string;
  code: string;
}

export interface RosterImportPreview {
  from: string;
  to: string;
  entryCount: number;
  people: RosterImportPerson[];
  unknowns: RosterUnknownCell[];
  /** Ready-made Russian naming the exact cells, or null when the file read cleanly.
   *  Unreadable cells are a warning, not a refusal — they import marked «?». */
  unknownsMessage: string | null;
  /** Cells the file marks '?': real entries the CSV can't express, which the import
   *  steps around instead of recreating (weekend work, one-off custom times). */
  preservedCount: number;
  /** How many entries the period already holds. Non-zero means applying needs `overwrite`. */
  existingCount: number;
}

export type RosterPersonResolution =
  | { csvName: string; action: "create" }
  | { csvName: string; action: "rename"; employeeId: number };

export interface RosterImportSummary {
  employeesRenamed: number;
  employeesCreated: number;
  entriesInserted: number;
  entriesDeleted: number;
  cellsPreserved: number;
  /** Pending swaps this import invalidated — people had open requests on entries
   *  the file replaced, and were told so. */
  swapsExpired: number;
  unknowns: RosterUnknownCell[];
}

/** A preset plus who may take it and who asked for it. An empty pool means everyone. */
export interface TemplateRolesView {
  templateId: number;
  name: string;
  category: EntryCategory;
  accent: TemplateAccent;
  /** Employee ids allowed to take this preset. Empty = everyone. */
  pool: number[];
  /** employeeId -> weight. Present means "asked for this kind". */
  preference: Record<number, number>;
}

/** One person's place in the queue for a kind of shift, already worded for display. */
export interface RotationTurnView {
  employeeId: number;
  displayName: string;
  daysSince: number | null;
  /** "Лапин (3 недели назад)" — ready to print. */
  label: string;
}

export interface TemplateQueue {
  templateId: number;
  rotationUnit: "day" | "week";
  asOf: string;
  queue: RotationTurnView[];
}

/** One row of «кто сколько отдежурил». */
export interface ShiftCountsRow {
  employeeId: number;
  displayName: string;
  byKind: Record<string, number>;
  total: number;
}

export interface ShiftCountsReport {
  from: string;
  to: string;
  /** Column order, already sorted the way the presets are shown elsewhere. */
  kinds: string[];
  rows: ShiftCountsRow[];
}

/** One line of the «кто когда что менял» history. */
export interface JournalEvent {
  id: number;
  type: string;
  createdAt: string;
  actorName: string | null;
  payload: unknown;
}

export interface JournalPage {
  total: number;
  limit: number;
  offset: number;
  /** Only the types actually present in the log, so the filter offers real options. */
  availableTypes: string[];
  events: JournalEvent[];
}

/** One round of collecting for one person's birthday, in one year. */
export interface BirthdayCampaign {
  id: number;
  employeeId: number;
  year: number;
  celebratedOn: string;
  collectUrl: string | null;
  messageText: string | null;
  status: "pending" | "ready" | "sent";
  adminNotifiedAt: string | null;
  sentAt: string | null;
  sentCount: number;
}

export interface UpcomingBirthday {
  employeeId: number;
  displayName: string;
  /** "MM-DD" as stored. */
  birthDate: string;
  /** "5 августа". */
  birthDateLabel: string;
  celebratedOn: string;
  daysUntil: number;
  campaign: BirthdayCampaign | null;
}

/** Exactly what would be sent, and to exactly whom — before anything leaves. */
export interface BirthdayPreview {
  employeeId: number;
  displayName: string;
  celebratedOn: string;
  collectUrl: string | null;
  message: string;
  recipients: { employeeId: number; displayName: string }[];
  /** Why sending is impossible right now, or null when it isn't. */
  blocker: string | null;
  alreadySentAt: string | null;
}

export interface ApiClient {
  getEmployees(): Promise<Employee[]>;
  getTeamSchedule(from: string, to: string): Promise<Shift[]>;
  getTemplates(): Promise<Template[]>;
  getEvents(): Promise<FeedEvent[]>;
  createEntry(input: NewEntryInput): Promise<Shift>;
  updateEntry(id: number, input: NewEntryInput): Promise<Shift>;
  deleteEntry(id: number): Promise<void>;
  createEmployee(name: string): Promise<CreateEmployeeResult>;
  archiveEmployee(id: number): Promise<void>;
  restoreEmployee(id: number): Promise<void>;
  setEmployeeAdmin(id: number, isAdmin: boolean): Promise<void>;
  renameEmployee(id: number, displayName: string): Promise<void>;
  /** `null` clears the birthday. */
  setBirthDate(id: number, birthDate: string | null): Promise<void>;
  /** Move a worker to `position` (1-based). The server renumbers the rest. */
  reorderEmployee(id: number, position: number): Promise<Employee[]>;
  /** (Re)issue the invite link for a worker who hasn't linked Telegram yet. */
  getEmployeeInvite(id: number, regenerate?: boolean): Promise<{ inviteToken: string; inviteLink: string | null }>;
  getWeekendSlots(): Promise<AdminSlotView[]>;
  /** The slot, plus how many of the team the «нужен человек» broadcast reached —
   *  only people who linked Telegram can be told at all. */
  postSlot(input: NewSlotInput): Promise<VacantSlot & { delivered: number; intended: number }>;
  assignSlot(slotId: number, employeeId: number): Promise<void>;
  unassignSlot(assignmentId: number): Promise<void>;
  getPayroll(from: string, to: string): Promise<PayrollRow[]>;
  getPayrollCsv(from: string, to: string): Promise<string>;
  getRosterCsv(from: string, to: string): Promise<string>;
  getShiftCounts(from: string, to: string): Promise<ShiftCountsReport>;
  getShiftCountsCsv(from: string, to: string): Promise<string>;
  getJournal(params: { types?: string[]; from?: string; to?: string; limit?: number; offset?: number }): Promise<JournalPage>;
  getBirthdays(): Promise<UpcomingBirthday[]>;
  saveBirthdayCampaign(employeeId: number, patch: { collectUrl?: string | null; messageText?: string | null }): Promise<BirthdayCampaign>;
  getBirthdayPreview(employeeId: number): Promise<BirthdayPreview>;
  /** Sends the collection to the whole team but the birthday person. Confirmed by the caller. */
  sendBirthday(employeeId: number): Promise<{ delivered: number; intended: number }>;
  getTemplateRoles(): Promise<TemplateRolesView[]>;
  getTemplateQueue(templateId: number): Promise<TemplateQueue>;
  setRotationUnit(templateId: number, rotationUnit: "day" | "week"): Promise<void>;
  saveTemplateRoles(templateId: number, pool: number[], preference: Record<number, number>): Promise<void>;
  previewRosterImport(csv: string): Promise<RosterImportPreview>;
  applyRosterImport(csv: string, resolutions: RosterPersonResolution[], overwrite?: boolean): Promise<RosterImportSummary>;
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


/**
 * Сетевой сбой — это не ответ сервера, а его отсутствие: `fetch` бросает
 * `TypeError: Failed to fetch` (в Chrome) или «NetworkError…» (в Firefox), и
 * именно эта английская строка доезжала до человека — она кладётся в
 * `Error.message`, а экраны показывают его как есть. Повод дёрнуть эту ветку
 * будничный: рестарт сервера при выкладке или лифт с плохим интернетом.
 *
 * То же правило, что у `refusalText`: то, что читает человек, пишется
 * по-русски. Ответ сервера с кодом мы не трогаем — у него свои переводы.
 */
export const OFFLINE_MESSAGE = "Нет связи с сервером — проверь интернет и попробуй ещё раз.";

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error(OFFLINE_MESSAGE);
  }
}

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
  const res = await apiFetch(`${API_BASE}/api/auth`, {
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
  const res = await apiFetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw await toError(path, res);
  }
  return (await res.json()) as T;
}

async function authorizedPostJson<T>(path: string, payload: unknown): Promise<T> {
  const token = await authToken();
  const res = await apiFetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await toError(path, res);
  }
  return (await res.json()) as T;
}

async function authorizedPutJson<T>(path: string, payload: unknown): Promise<T> {
  const token = await authToken();
  const res = await apiFetch(`${API_BASE}${path}`, {
    method: "PUT",
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
  const res = await apiFetch(`${API_BASE}${path}`, {
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
  const res = await apiFetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw await toError(path, res);
  }
}

/** Экспортируется ради теста про сетевой сбой — в приложение уходит `apiClient` ниже. */
export const realClient: ApiClient = {
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

  async updateEntry(id, input) {
    const { entry } = await authorizedPatchJson<{ entry: Shift }>(`/api/admin/entries/${id}`, input);
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

  async reorderEmployee(id, position) {
    const { employees } = await authorizedPostJson<{ employees: Employee[] }>(
      `/api/admin/employees/${id}/order`,
      { position },
    );
    return employees;
  },

  async setBirthDate(id, birthDate) {
    await authorizedPatchJson(`/api/admin/employees/${id}`, { birthDate });
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
    const { slot, delivered, intended } = await authorizedPostJson<{ slot: VacantSlot; delivered: number; intended: number }>(
      "/api/admin/weekend/slots",
      input,
    );
    return { ...slot, delivered, intended };
  },

  async assignSlot(slotId, employeeId) {
    await authorizedPostJson(`/api/admin/weekend/slots/${slotId}/assign`, { employeeId });
  },
  async unassignSlot(assignmentId) {
    await authorizedPostJson(`/api/admin/weekend/assignments/${assignmentId}/unassign`, {});
  },

  async getPayroll(from, to) {
    const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const { rows } = await authorizedGet<{ rows: PayrollRow[] }>(`/api/admin/weekend/payroll?${q}`);
    return rows;
  },

  async getPayrollCsv(from, to) {
    const token = await authToken();
    const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await apiFetch(`${API_BASE}/api/admin/weekend/payroll.csv?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw await toError("/api/admin/weekend/payroll.csv", res);
    return res.text();
  },

  async getRosterCsv(from, to) {
    const token = await authToken();
    const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await apiFetch(`${API_BASE}/api/admin/roster.csv?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw await toError("/api/admin/roster.csv", res);
    return res.text();
  },

  getShiftCounts(from, to) {
    const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    return authorizedGet<ShiftCountsReport>(`/api/admin/reports/shift-counts?${q}`);
  },

  async getShiftCountsCsv(from, to) {
    const token = await authToken();
    const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const path = `/api/admin/reports/shift-counts.csv?${q}`;
    const res = await apiFetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw await toError(path, res);
    return res.text();
  },

  getJournal(params) {
    const q = new URLSearchParams();
    if (params.types?.length) q.set("types", params.types.join(","));
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);
    q.set("limit", String(params.limit ?? 50));
    q.set("offset", String(params.offset ?? 0));
    return authorizedGet<JournalPage>(`/api/admin/journal?${q.toString()}`);
  },

  async getBirthdays() {
    const { birthdays } = await authorizedGet<{ birthdays: UpcomingBirthday[] }>("/api/admin/birthdays");
    return birthdays;
  },

  async saveBirthdayCampaign(employeeId, patch) {
    const { campaign } = await authorizedPutJson<{ campaign: BirthdayCampaign }>(`/api/admin/birthdays/${employeeId}`, patch);
    return campaign;
  },

  getBirthdayPreview(employeeId) {
    return authorizedGet<BirthdayPreview>(`/api/admin/birthdays/${employeeId}/preview`);
  },

  sendBirthday(employeeId) {
    // `confirm` is sent here so no caller can forget it — but the server refuses
    // without it either way, and the screen still asks the admin out loud first.
    return authorizedPostJson<{ delivered: number; intended: number }>(`/api/admin/birthdays/${employeeId}/send`, { confirm: true });
  },

  getTemplateQueue(templateId) {
    return authorizedGet<TemplateQueue>(`/api/admin/templates/${templateId}/queue`);
  },

  async getTemplateRoles() {
    const { templates } = await authorizedGet<{ templates: TemplateRolesView[] }>("/api/admin/templates/roles");
    return templates;
  },

  async setRotationUnit(templateId, rotationUnit) {
    const token = await authToken();
    const path = `/api/admin/templates/${templateId}/rotation`;
    const res = await apiFetch(`${API_BASE}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ rotationUnit }),
    });
    if (!res.ok) throw await toError(path, res);
  },

  async saveTemplateRoles(templateId, pool, preference) {
    await authorizedPutJson(`/api/admin/templates/${templateId}/roles`, { pool, preference });
  },

  previewRosterImport(csv) {
    return authorizedPostJson<RosterImportPreview>("/api/admin/roster/import/preview", { csv });
  },

  async applyRosterImport(csv, resolutions, overwrite = false) {
    const { summary } = await authorizedPostJson<{ summary: RosterImportSummary }>(
      "/api/admin/roster/import/apply",
      { csv, resolutions, overwrite },
    );
    return summary;
  },
};

const devClient: ApiClient = {
  getEmployees: () => mockGetEmployees(),
  getTeamSchedule: (from, to) => mockGetTeamSchedule(from, to),
  getTemplates: () => mockGetTemplates(),
  getEvents: () => mockGetEvents(),
  createEntry: (input) => mockCreateEntry(input),
  updateEntry: (id, input) => mockUpdateEntry(id, input),
  deleteEntry: (id) => mockDeleteEntry(id),
  createEmployee: (name) => mockCreateEmployee(name),
  archiveEmployee: (id) => mockArchiveEmployee(id),
  restoreEmployee: (id) => mockRestoreEmployee(id),
  setEmployeeAdmin: (id, isAdmin) => mockSetEmployeeAdmin(id, isAdmin),
  renameEmployee: (id, displayName) => mockRenameEmployee(id, displayName),
  setBirthDate: (id, birthDate) => mockSetBirthDate(id, birthDate),
  reorderEmployee: (id, position) => mockReorderEmployee(id, position),
  getEmployeeInvite: (id, regenerate) => mockGetEmployeeInvite(id, regenerate),
  getWeekendSlots: () => mockGetWeekendSlots(),
  postSlot: (input) => mockPostSlot(input),
  assignSlot: (slotId, employeeId) => mockAssignSlot(slotId, employeeId),
  unassignSlot: (assignmentId) => mockUnassignSlot(assignmentId),
  getPayroll: (from, to) => mockGetPayroll(from, to),
  getPayrollCsv: (from, to) => mockGetPayrollCsv(from, to),
  getRosterCsv: (from, to) => mockGetRosterCsv(from, to),
  getShiftCounts: (from, to) => mockGetShiftCounts(from, to),
  getShiftCountsCsv: (from, to) => mockGetShiftCountsCsv(from, to),
  getJournal: (params) => mockGetJournal(params),
  getBirthdays: () => mockGetBirthdays(),
  saveBirthdayCampaign: (employeeId, patch) => mockSaveBirthdayCampaign(employeeId, patch),
  getBirthdayPreview: (employeeId) => mockGetBirthdayPreview(employeeId),
  sendBirthday: (employeeId) => mockSendBirthday(employeeId),
  getTemplateRoles: () => mockGetTemplateRoles(),
  getTemplateQueue: (templateId) => mockGetTemplateQueue(templateId),
  setRotationUnit: (templateId, unit) => mockSetRotationUnit(templateId, unit),
  saveTemplateRoles: (templateId, pool, preference) => mockSaveTemplateRoles(templateId, pool, preference),
  previewRosterImport: (csv) => mockPreviewRosterImport(csv),
  applyRosterImport: (csv, resolutions, overwrite) => mockApplyRosterImport(csv, resolutions, overwrite),
};

/**
 * In dev, short-circuits to realistic mock data so the app renders with no
 * backend running. In production, authenticates via Telegram initData and
 * talks to the real API at `VITE_API_BASE`.
 */
export const apiClient: ApiClient = import.meta.env.DEV ? devClient : realClient;
