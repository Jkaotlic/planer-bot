import { initDataRaw, restoreInitData } from "@telegram-apps/sdk-react";
import type { Category, TemplateAccent } from "../categories";
import {
  mockAcceptSwap,
  mockCancelSwap,
  mockDeclineSwap,
  mockGetMe,
  mockSetRemindersEnabled,
  mockSetPreferredName,
  mockGetMyShifts,
  mockGetSwaps,
  mockGetTeamSchedule,
  mockProposeSwap,
  mockGetWeekendSlots,
  mockExpressInterest,
  mockGetWeekendOffers,
  mockConfirmOffer,
  mockDeclineOffer,
  mockGetAdminEmployees,
  mockCreateEmployee,
  mockArchiveEmployee,
  mockRestoreEmployee,
  mockSetEmployeeAdmin,
  mockRenameEmployee,
  mockSetEmployeePreferredName,
  mockSetBirthDate,
  mockReorderEmployee,
  mockGetEmployeeInvite,
  mockGetTemplates,
  mockCreateEntry,
  mockUpdateEntry,
  mockDeleteEntry,
  mockDistribute,
  mockGetAdminWeekendSlots,
  mockPostSlot,
  mockAssignSlot,
  mockUnassignSlot,
  mockGetPayroll,
  mockGetPayrollCsv,
  mockGetShiftCounts,
  mockGetJournal,
  mockGetBirthdays,
  mockSaveBirthdayCampaign,
  mockGetBirthdayCampaigns,
  mockGetBirthdayPreview,
  mockSendBirthday,
  mockGetTemplateRoles,
  mockGetTemplateQueue,
  mockSetRotationUnit,
  mockSaveTemplateRoles,
  mockGetRosterCsv,
  mockPreviewRosterImport,
  mockApplyRosterImport,
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
  /** Optional place for duties, offsite work, and other location-specific entries. */
  location: string | null;
  /** Set only when a roster import could not read this cell: the original text,
   *  e.g. «Ко». Such an entry has no preset and no times, and draws as «?». */
  unrecognisedCode?: string | null;
  /** The preset this entry came from, if any — drives its colour in the schedule. */
  templateId: number | null;
  employeeId: number | null;
  /**
   * Not part of the raw shift row — the real client joins it from the roster
   * returned by `/api/team/schedule` (id -> displayName).
   * Only `getTeamSchedule` populates this; `getMyShifts` leaves it
   * `undefined` (every row already belongs to the caller).
   */
  employeeName?: string;
}

export interface TeamEmployee {
  id: number;
  displayName: string;
  rosterOrder: number | null;
}

export interface TeamSchedule {
  employees: TeamEmployee[];
  shifts: Shift[];
}

export interface Me {
  id: number;
  /** «Фамилия Имя» as the roster has it — for lists and columns. */
  displayName: string;
  /** What to greet this person with: their Telegram first name when we know it.
   *  Never derive this from `displayName` — see `addressOf` in @planer/shared. */
  address: string;
  /** What they typed into «Как ко мне обращаться». Null → `address` came from
   *  Telegram or from the roster. */
  preferredName: string | null;
  isAdmin: boolean;
  /** Their own shift-reminder switch. */
  remindersEnabled: boolean;
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

/** An open slot: whether the current user raised their hand, and who is already going. */
export interface WeekendSlotView {
  slot: VacantSlot;
  interested: boolean;
  assignees: { employeeId: number; name: string; status: string }[];
}

export type WeekendOfferStatus = "offered" | "confirmed" | "declined";

/** A weekend-work offer addressed to the current user: the slot, and the assignment's state. */
export interface WeekendOffer {
  assignment: { id: number; status: WeekendOfferStatus; hours: number };
  slot: VacantSlot;
}

// --- Admin-only types (the "Админ" tab) --------------------------------------
// Ported verbatim from the desktop console's client (`admin/src/api/client.ts`)
// so the mini-app admin surface speaks the exact same shapes as the web one.

/** A worker row in the "Работники" screen and the add-entry employee picker. */
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
  /** Set by the worker or by an admin; null falls back through Telegram to the roster. */
  preferredName: string | null;
  /** What the bot will actually call them — computed server-side by `addressOf`. */
  address: string;
}

/** A saved shift preset the add-entry form can offer, with Friday-shortened times. */
export interface Template {
  id: number;
  sortOrder: number;
  name: string;
  start: string;
  end: string;
  fridayStart: string;
  fridayEnd: string;
  isLate: boolean;
  sendReminder: boolean;
  /** Which kind of entry this preset creates — default "shift"; e.g. the Поклонка preset is a "duty". */
  category: Category;
  /** Default place for duty/offsite presets (prefills the entry form's "Место"), null for plain shifts. */
  location: string | null;
  /** Colour slot so each preset reads apart in the schedule. */
  accent: TemplateAccent;
}

export interface CreateEmployeeResult {
  employee: Employee;
  /** Single-use token embedded in the invite deep-link. */
  inviteToken: string;
  /** Ready-made `https://t.me/<bot>?start=<token>` deep-link, or `null` if the server has no bot username configured. */
  inviteLink: string | null;
}

/** Body for creating (or patching) a schedule entry — mirrors the server's `createEntrySchema`. */
export interface NewEntryInput {
  date: string;
  category: Category;
  start?: string;
  end?: string;
  endDate?: string;
  templateId?: number;
  employeeId?: number;
  location?: string;
  /** `null` clears the stored title (e.g. switching a preset shift to custom times). */
  title?: string | null;
}

/** One interested worker for a slot, with their confirmed-this-month count driving the fairness hint. */
export interface SlotInterest {
  employeeId: number;
  name: string;
  confirmedThisMonth: number;
  /** Times they volunteered for a slot that went to someone else — breaks ties in their favour. */
  passedOver: number;
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

/** One confirmed weekend-work record for the payroll ledger. */
export interface PayrollRow {
  employeeId: number;
  employeeName: string;
  date: string;
  hours: number;
}

/** One shift the fair-distribution pass would (or did) hand to a worker. */
export interface DistributionAssignment {
  shiftId: number;
  employeeId: number;
}

/** Result of `POST /api/admin/distribute`: whether it was applied, plus the chosen assignments. */
export interface DistributeResult {
  applied: boolean;
  assignments: DistributionAssignment[];
}

/** A preset plus who may take it and who asked for it. An empty pool means everyone. */
export interface TemplateRolesView {
  templateId: number;
  name: string;
  category: Category;
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
  availableTypes: string[];
  /** Everyone who has ever been the actor of an event — only real actors, not the
   *  whole roster — so the person filter offers only people who actually did something. */
  availableActors: { id: number; displayName: string }[];
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
  /** The day an admin asked to be reminded to send it. Null when they didn't ask. */
  scheduledSendOn: string | null;
  scheduleNotifiedAt: string | null;
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

/** A prepared round, with the person it belongs to. Unlike `UpcomingBirthday`
 *  this includes rounds whose birthday has already passed. */
export interface CampaignListRow {
  campaign: BirthdayCampaign;
  displayName: string;
  birthDateLabel: string;
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
  getMe(): Promise<Me>;
  /** Turns this person's own shift reminders on or off. */
  setRemindersEnabled(enabled: boolean): Promise<boolean>;
  /** `null` clears it and hands the greeting back to Telegram's name. */
  setPreferredName(preferredName: string | null): Promise<{ preferredName: string | null; address: string }>;
  getMyShifts(from: string): Promise<Shift[]>;
  getTeamSchedule(from: string, to: string): Promise<TeamSchedule>;
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

  // --- Admin-only (the "Админ" tab) -----------------------------------------
  // Only ever called from `AdminScreen` when `me.isAdmin` is true. The server
  // guards every one of these with `requireAdmin`, so a non-admin session gets
  // a 403 even if the client somehow invoked them.
  getAdminEmployees(): Promise<Employee[]>;
  createEmployee(name: string): Promise<CreateEmployeeResult>;
  archiveEmployee(id: number): Promise<void>;
  restoreEmployee(id: number): Promise<void>;
  setEmployeeAdmin(id: number, isAdmin: boolean): Promise<void>;
  renameEmployee(id: number, displayName: string): Promise<void>;
  setEmployeePreferredName(id: number, preferredName: string | null): Promise<void>;
  /** `null` clears the birthday. */
  setBirthDate(id: number, birthDate: string | null): Promise<void>;
  /** Move a worker to `position` (1-based). The server renumbers the rest. */
  reorderEmployee(id: number, position: number): Promise<Employee[]>;
  /** (Re)issue the invite link for a worker who hasn't linked Telegram yet. */
  getEmployeeInvite(id: number, regenerate?: boolean): Promise<{ inviteToken: string; inviteLink: string | null }>;
  getTemplates(): Promise<Template[]>;
  createEntry(input: NewEntryInput): Promise<Shift>;
  updateEntry(id: number, input: NewEntryInput): Promise<Shift>;
  deleteEntry(id: number): Promise<void>;
  distribute(from: string, to: string, apply: boolean): Promise<DistributeResult>;
  getAdminWeekendSlots(): Promise<AdminSlotView[]>;
  postSlot(input: NewSlotInput): Promise<VacantSlot>;
  assignSlot(slotId: number, employeeId: number): Promise<void>;
  unassignSlot(assignmentId: number): Promise<void>;
  getPayroll(from: string, to: string): Promise<PayrollRow[]>;
  getPayrollCsv(from: string, to: string): Promise<string>;
  getShiftCounts(from: string, to: string): Promise<ShiftCountsReport>;
  getJournal(params: { types?: string[]; actor?: number; limit?: number; offset?: number }): Promise<JournalPage>;
  getBirthdays(): Promise<UpcomingBirthday[]>;
  saveBirthdayCampaign(
    employeeId: number,
    patch: { collectUrl?: string | null; messageText?: string | null; scheduledSendOn?: string | null },
  ): Promise<BirthdayCampaign>;
  /** Every round ever prepared, newest first — the sent ones included. */
  getBirthdayCampaigns(): Promise<CampaignListRow[]>;
  getBirthdayPreview(employeeId: number): Promise<BirthdayPreview>;
  /** Sends the collection to the whole team but the birthday person. Confirmed by the caller. */
  sendBirthday(employeeId: number): Promise<{ delivered: number; intended: number }>;
  getTemplateRoles(): Promise<TemplateRolesView[]>;
  getTemplateQueue(templateId: number): Promise<TemplateQueue>;
  setRotationUnit(templateId: number, rotationUnit: "day" | "week"): Promise<void>;
  saveTemplateRoles(templateId: number, pool: number[], preference: Record<number, number>): Promise<void>;
  getRosterCsv(from: string, to: string): Promise<string>;
  previewRosterImport(csv: string): Promise<RosterImportPreview>;
  applyRosterImport(csv: string, resolutions: RosterPersonResolution[], overwrite?: boolean): Promise<RosterImportSummary>;
}

/** One row of the uploaded file, and the active worker whose name matches it exactly. */
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
  /** Cells written as '?': entries the matrix can't express, which the import leaves alone. */
  preservedCount: number;
  /** What the period already holds — non-zero means applying needs `overwrite`. */
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
  unknowns: RosterUnknownCell[];
}

interface ShiftsResponse {
  shifts: Shift[];
}

/** `GET /api/admin/employees` — the richer admin roster (active + archived). */
interface AdminEmployeesResponse {
  employees: Employee[];
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

async function authorizedPatchJson<T>(path: string, payload: unknown): Promise<T> {
  const token = await authToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(path, res));
  }
  return (await res.json()) as T;
}

async function authorizedPutJson<T>(path: string, payload: unknown): Promise<T> {
  const token = await authToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
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

/** Fetches and maps `GET /api/swaps` to the enriched UI shape. Shared by
 * `getSwaps` and `proposeSwap` (the latter re-fetches to get the freshly
 * created request's enriched view, since `POST /api/swaps` only echoes the raw row). */
async function fetchSwaps(): Promise<SwapRequest[]> {
  const { swaps } = await authorizedGet<SwapsResponse>("/api/swaps");
  return swaps.map(toSwapRequest);
}

export const realClient: ApiClient = {
  getMe: () => authorizedGet<Me>("/api/me"),

  async setRemindersEnabled(enabled) {
    const res = await authorizedPatchJson<{ remindersEnabled: boolean }>("/api/me/settings", { remindersEnabled: enabled });
    return res.remindersEnabled;
  },

  setPreferredName: (preferredName) =>
    authorizedPatchJson<{ preferredName: string | null; address: string }>("/api/me/settings", { preferredName }),

  async getMyShifts(from) {
    const { shifts } = await authorizedGet<ShiftsResponse>(`/api/my/shifts?from=${encodeURIComponent(from)}`);
    return shifts;
  },

  async getTeamSchedule(from, to) {
    const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const schedule = await authorizedGet<TeamSchedule>(`/api/team/schedule?${query}`);
    const nameById = new Map(schedule.employees.map((employee) => [employee.id, employee.displayName]));
    return {
      employees: schedule.employees,
      shifts: schedule.shifts.map((shift) => ({
        ...shift,
        employeeName: shift.employeeId != null ? nameById.get(shift.employeeId) : undefined,
      })),
    };
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

  // --- Admin-only ------------------------------------------------------------
  async getAdminEmployees() {
    const { employees } = await authorizedGet<AdminEmployeesResponse>("/api/admin/employees");
    return employees;
  },
  createEmployee: (name) => authorizedPostJson<CreateEmployeeResult>("/api/admin/employees", { displayName: name }),
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
  async setEmployeePreferredName(id, preferredName) {
    await authorizedPatchJson(`/api/admin/employees/${id}`, { preferredName });
  },
  getEmployeeInvite(id, regenerate = false) {
    return authorizedPostJson<{ inviteToken: string; inviteLink: string | null }>(`/api/admin/employees/${id}/invite`, { regenerate });
  },

  async getTemplates() {
    const { templates } = await authorizedGet<{ templates: Template[] }>("/api/templates");
    return templates;
  },

  async createEntry(input) {
    const { entry } = await authorizedPostJson<{ entry: Shift }>("/api/admin/entries", input);
    return entry;
  },
  async updateEntry(id, input) {
    const { entry } = await authorizedPatchJson<{ entry: Shift }>(`/api/admin/entries/${id}`, input);
    return entry;
  },
  deleteEntry: (id) => authorizedDelete(`/api/admin/entries/${id}`),

  distribute: (from, to, apply) =>
    authorizedPostJson<DistributeResult>("/api/admin/distribute", { from, to, apply }),

  async getAdminWeekendSlots() {
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
  async unassignSlot(assignmentId) {
    await authorizedPostJson(`/api/admin/weekend/assignments/${assignmentId}/unassign`, {});
  },

  async getPayroll(from, to) {
    const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const { rows } = await authorizedGet<{ rows: PayrollRow[] }>(`/api/admin/weekend/payroll?${q}`);
    return rows;
  },
  async getPayrollCsv(from, to) {
    // Unlike every other admin call this returns raw CSV text, not JSON — the
    // screen wraps it in a Blob + download link (see `AdminWeekendScreen`).
    const token = await authToken();
    const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await fetch(`${API_BASE}/api/admin/weekend/payroll.csv?${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await errorMessage("/api/admin/weekend/payroll.csv", res));
    return res.text();
  },

  getShiftCounts(from, to) {
    const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    return authorizedGet<ShiftCountsReport>(`/api/admin/reports/shift-counts?${q}`);
  },

  getJournal(params) {
    const q = new URLSearchParams();
    if (params.types?.length) q.set("types", params.types.join(","));
    if (params.actor != null) q.set("actor", String(params.actor));
    q.set("limit", String(params.limit ?? 30));
    q.set("offset", String(params.offset ?? 0));
    return authorizedGet<JournalPage>(`/api/admin/journal?${q.toString()}`);
  },

  async getBirthdays() {
    const { birthdays } = await authorizedGet<{ birthdays: UpcomingBirthday[] }>("/api/admin/birthdays");
    return birthdays;
  },

  async getBirthdayCampaigns() {
    const { campaigns } = await authorizedGet<{ campaigns: CampaignListRow[] }>("/api/admin/birthdays/campaigns");
    return campaigns;
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
    const res = await fetch(`${API_BASE}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ rotationUnit }),
    });
    if (!res.ok) throw new Error(await errorMessage(path, res));
  },

  async saveTemplateRoles(templateId, pool, preference) {
    const token = await authToken();
    const path = `/api/admin/templates/${templateId}/roles`;
    const res = await fetch(`${API_BASE}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pool, preference }),
    });
    if (!res.ok) throw new Error(await errorMessage(path, res));
  },

  async getRosterCsv(from, to) {
    const token = await authToken();
    const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await fetch(`${API_BASE}/api/admin/roster.csv?${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await errorMessage("/api/admin/roster.csv", res));
    return res.text();
  },

  previewRosterImport: (csv) =>
    authorizedPostJson<RosterImportPreview>("/api/admin/roster/import/preview", { csv }),

  async applyRosterImport(csv, resolutions, overwrite = false) {
    const { summary } = await authorizedPostJson<{ summary: RosterImportSummary }>(
      "/api/admin/roster/import/apply",
      { csv, resolutions, overwrite },
    );
    return summary;
  },
};

const devClient: ApiClient = {
  getMe: () => mockGetMe(),
  setRemindersEnabled: (enabled) => mockSetRemindersEnabled(enabled),
  setPreferredName: (preferredName) => mockSetPreferredName(preferredName),
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

  getAdminEmployees: () => mockGetAdminEmployees(),
  createEmployee: (name) => mockCreateEmployee(name),
  archiveEmployee: (id) => mockArchiveEmployee(id),
  restoreEmployee: (id) => mockRestoreEmployee(id),
  setEmployeeAdmin: (id, isAdmin) => mockSetEmployeeAdmin(id, isAdmin),
  renameEmployee: (id, displayName) => mockRenameEmployee(id, displayName),
  setEmployeePreferredName: (id, preferredName) => mockSetEmployeePreferredName(id, preferredName),
  setBirthDate: (id, birthDate) => mockSetBirthDate(id, birthDate),
  reorderEmployee: (id, position) => mockReorderEmployee(id, position),
  getEmployeeInvite: (id, regenerate) => mockGetEmployeeInvite(id, regenerate),
  getTemplates: () => mockGetTemplates(),
  createEntry: (input) => mockCreateEntry(input),
  updateEntry: (id, input) => mockUpdateEntry(id, input),
  deleteEntry: (id) => mockDeleteEntry(id),
  distribute: (from, to, apply) => mockDistribute(from, to, apply),
  getAdminWeekendSlots: () => mockGetAdminWeekendSlots(),
  postSlot: (input) => mockPostSlot(input),
  assignSlot: (slotId, employeeId) => mockAssignSlot(slotId, employeeId),
  unassignSlot: (assignmentId) => mockUnassignSlot(assignmentId),
  getPayroll: (from, to) => mockGetPayroll(from, to),
  getPayrollCsv: (from, to) => mockGetPayrollCsv(from, to),
  getShiftCounts: (from, to) => mockGetShiftCounts(from, to),
  getJournal: (params) => mockGetJournal(params),
  getBirthdays: () => mockGetBirthdays(),
  getBirthdayCampaigns: () => mockGetBirthdayCampaigns(),
  saveBirthdayCampaign: (employeeId, patch) => mockSaveBirthdayCampaign(employeeId, patch),
  getBirthdayPreview: (employeeId) => mockGetBirthdayPreview(employeeId),
  sendBirthday: (employeeId) => mockSendBirthday(employeeId),
  getTemplateRoles: () => mockGetTemplateRoles(),
  getTemplateQueue: (templateId) => mockGetTemplateQueue(templateId),
  setRotationUnit: (templateId, unit) => mockSetRotationUnit(templateId, unit),
  saveTemplateRoles: (templateId, pool, preference) => mockSaveTemplateRoles(templateId, pool, preference),
  getRosterCsv: (from, to) => mockGetRosterCsv(from, to),
  previewRosterImport: (csv) => mockPreviewRosterImport(csv),
  applyRosterImport: (csv, resolutions, overwrite) => mockApplyRosterImport(csv, resolutions, overwrite),
};

/**
 * In dev, short-circuits to realistic mock data so the app renders with no
 * backend running. In production, authenticates via Telegram initData and
 * talks to the real API at `VITE_API_BASE`.
 */
export const apiClient: ApiClient = import.meta.env.DEV ? devClient : realClient;
