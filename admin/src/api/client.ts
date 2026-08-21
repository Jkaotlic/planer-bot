import { initDataRaw, restoreInitData } from "@telegram-apps/sdk-react";
import { AuthRequiredError, OFFLINE_MESSAGE, createEmployeesApi, createReadApi, createTransport } from "@planer/client";
import type {
  AdminEmployeeDto,
  CreateEmployeeResponse,
  EntryCategory,
  ScheduleEntryDto,
  TemplateAccent,
  TemplateDto,
} from "@planer/shared";
import {
  employeesMock,
  mockCreateEntry,
  mockUpdateEntry,
  mockDeleteEntry,
  mockGetEvents,
  mockGetTeamSchedule,
  mockGetTemplates,
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
  mockGetBirthdayPreview,
  mockSaveBirthdayRound,
  mockGetCollections,
  mockCreateCollection,
  mockGetCollectionPreview,
  mockSaveCollection,
  mockSendCollection,
  mockSetCollectionClosed,
  mockDeleteCollection,
  mockGetTemplateRoles,
  mockGetTemplateQueue,
  mockSetRotationUnit,
  mockSaveTemplateRoles,
  mockPreviewRosterImport,
  mockApplyRosterImport,
  mockGetSettings,
  mockSetSwapsLock,
  mockGetAnnouncementRecipients,
  mockSendAnnouncement,
  mockGetBugReports,
  mockResolveBugReport,
} from "./mock";

/**
 * Работник — DTO из контракта.
 *
 * Форма была объявлена здесь своими словами и не знала `preferredName`, хотя
 * сервер его отдаёт: консоль поле не читает — «обращение» человек задаёт себе
 * сам в мини-аппе. Теперь оно просто есть и остаётся непрочитанным, а тип один
 * на сервер и на оба фронта.
 */
export type Employee = AdminEmployeeDto;

/** A single scheduled entry: a work shift, duty, or a (possibly multi-day) absence. */
/**
 * Запись графика — DTO из контракта.
 *
 * Форма была объявлена здесь своими словами и успела разойтись с сервером:
 * `unrecognisedCode` значился необязательным, хотя сервер отдаёт его всегда,
 * пусть и `null`. `location` тут не было вовсе — см. находку в ledger.
 */
export type Shift = ScheduleEntryDto;

/** A saved preset the add-panel can offer, with Friday-shortened times. */
/**
 * Пресет смены — форма из контракта, с одним сужением.
 *
 * `sortOrder` в контракте есть, а здесь его раньше не было: консоль поле не
 * читает, порядок ей приходит уже отсортированным (`repo/templates.ts` — 
 * `orderBy(sortOrder)`). Теперь оно просто есть и остаётся непрочитанным.
 *
 * `accent` наоборот сужен против контракта: сервер отдаёт строку намеренно
 * (новый цвет в базе не должен ронять контракт), а палитре нужен перечислимый тип.
 */
export interface Template extends Omit<TemplateDto, "accent"> {
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

/** Ответ создания работника: он сам, токен приглашения и готовая ссылка. */
export type CreateEmployeeResult = CreateEmployeeResponse;

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

/** Один багрепорт списком — контракт `GET /api/admin/bug-reports`. Форма
 *  скопирована из `miniapp/src/api/client.ts` дословно: два разных DTO под
 *  одну серверную ручку разъехались бы и остались незамеченными. */
export interface BugReportRow {
  id: number;
  authorName: string;
  text: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
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

/** Сбор денег: раунд ДР — заводится системой из даты рождения — или сбор,
 *  заведённый админом руками по любому поводу. */
export interface Collection {
  id: number;
  kind: "birthday" | "custom";
  employeeId: number | null;
  year: number | null;
  celebratedOn: string | null;
  title: string | null;
  eventDate: string | null;
  deadline: string | null;
  amountPerPerson: number | null;
  totalGoal: number | null;
  collectUrl: string | null;
  messageText: string | null;
  closedAt: string | null;
  scheduledSendOn: string | null;
  scheduleNotifiedAt: string | null;
  sentAt: string | null;
  sentCount: number;
  sendCount: number;
  createdAt: string;
}

/** Строка списка сборов: сама запись плюс всё, что сервер уже посчитал. */
export interface CollectionRow {
  collection: Collection;
  personName: string | null;
  title: string;
  status: "pending" | "ready" | "sent";
  active: boolean;
}

/** Ровно то, что уйдёт команде, и кому именно — до того, как что-то ушло. */
export interface CollectionPreview {
  id: number;
  kind: "birthday" | "custom";
  title: string;
  personName: string | null;
  employeeId: number | null;
  collectUrl: string | null;
  message: string;
  recipients: { employeeId: number; displayName: string }[];
  /** Почему рассылка сейчас невозможна, или null, если возможна. */
  blocker: string | null;
  sendCount: number;
  lastSentAt: string | null;
}

/** Всё, что может задать админ при заведении кастомного сбора. */
export interface NewCollectionInput {
  title: string;
  employeeId?: number | null;
  eventDate?: string | null;
  deadline?: string | null;
  amountPerPerson?: number | null;
  totalGoal?: number | null;
  collectUrl?: string | null;
  messageText?: string | null;
  scheduledSendOn?: string | null;
}

/** Правка сбора: отсутствующий ключ значит «оставить как есть». */
export type CollectionPatch = Partial<NewCollectionInput>;

export interface UpcomingBirthday {
  employeeId: number;
  displayName: string;
  /** "MM-DD" as stored. */
  birthDate: string;
  /** "5 августа". */
  birthDateLabel: string;
  celebratedOn: string;
  daysUntil: number;
  campaign: Collection | null;
}

/** До скольких из скольких дошло письмо о правке графика. */
export interface NotifyReach {
  delivered: number;
  intended: number;
}

/** Состояние общего замка обменов сменами — экран «Настройки». */
export interface AdminSettings {
  swapsLocked: boolean;
  /** ISO-строка или null, если тумблер ни разу не трогали. */
  swapsLockUpdatedAt: string | null;
  swapsLockUpdatedBy: string | null;
}

/** Итог переключения замка: что стало, и какой ценой (кому дошло уведомление). */
export interface SwapLockResult {
  locked: boolean;
  cancelled: number;
  delivered: number;
  intended: number;
}

/** Зеркалит `ANNOUNCEMENT_TEXT_MAX` из `server/src/announcements/announcement-service.ts`.
 *  Не импортируется оттуда: тот модуль тянет `grammy`, серверную зависимость, которой
 *  не место в бандле консоли. Разойдись значения — счётчик соврёт на пару символов,
 *  но 400 всё равно решает сервер; здесь только подсказка. Само число и это же
 *  рассуждение уже есть в `miniapp/src/api/client.ts` — константа не общая (нет в
 *  `@planer/shared`), поэтому продублирована так же, как её продублировал мини-апп. */
export const ANNOUNCEMENT_TEXT_MAX = 2000;

/** Кому уйдёт анонс: вся команда или выбранные id — контракт `POST /api/announcements`. */
export type AnnouncementAudience = "all" | number[];

/** Кому реально ушло и кто не получил ничего, поимённо — отчёт после отправки. */
export interface AnnouncementResult {
  delivered: number;
  intended: number;
  unreachable: string[];
}

/** Один потенциальный адресат — контракт `GET /api/announcements/recipients`.
 *  Без телефонов и инвайт-токенов: экрану «Анонсы» нужны ровно имя и «дойдёт ли». */
export interface AnnouncementRecipient {
  id: number;
  displayName: string;
  reachable: boolean;
}

/**
 * Кто вошёл в консоль — ровно столько, сколько нужно подписи в сайдбаре.
 *
 * Консоль этого не спрашивала вовсе и подписывалась ПЕРВЫМ активным админом из
 * ростера: при двух админах в футере стояло чужое имя. Ручка `/api/me` на
 * сервере была всё это время, ей пользовался только мини-апп.
 */
export interface Viewer {
  id: number;
  displayName: string;
  address: string;
}

export interface ApiClient {
  getMe(): Promise<Viewer>;
  getEmployees(): Promise<Employee[]>;
  getTeamSchedule(from: string, to: string): Promise<Shift[]>;
  getTemplates(): Promise<Template[]>;
  getEvents(): Promise<FeedEvent[]>;
  createEntry(input: NewEntryInput): Promise<{ entry: Shift; notified: NotifyReach }>;
  updateEntry(id: number, input: NewEntryInput): Promise<{ entry: Shift; notified: NotifyReach }>;
  deleteEntry(id: number): Promise<{ notified: NotifyReach }>;
  createEmployee(name: string): Promise<CreateEmployeeResult>;
  archiveEmployee(id: number): Promise<void>;
  restoreEmployee(id: number): Promise<void>;
  setEmployeeAdmin(id: number, isAdmin: boolean): Promise<void>;
  renameEmployee(id: number, displayName: string): Promise<void>;
  /** `null` clears the birthday. */
  setBirthDate(id: number, birthDate: string | null): Promise<void>;
  /** Sets one or both exclusion flags. Turning on `excludedFromSwaps` cancels
   *  this person's open swap requests and notifies them — the caller doesn't
   *  need to do anything else for that to happen. */
  setEmployeeRestrictions(id: number, patch: { excludedFromAssignment?: boolean; excludedFromSwaps?: boolean }): Promise<void>;
  /** Роль «Наблюдатель»: смотрит график, ведёт свой (если включил тумблер), шлёт
   *  анонсы — вне раздачи, обменов и передачи смен. Снятие роли не трогает
   *  `excludedFrom*` выше — они остаются такими же, как были до неё. */
  setEmployeeObserver(id: number, isObserver: boolean): Promise<void>;
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
  getBirthdayPreview(employeeId: number): Promise<CollectionPreview>;
  /** Сохраняет раунд ДР; на первом сохранении он и заводится. */
  saveBirthdayRound(employeeId: number, patch: CollectionPatch): Promise<Collection>;
  getCollections(): Promise<CollectionRow[]>;
  createCollection(input: NewCollectionInput): Promise<Collection>;
  getCollectionPreview(id: number): Promise<CollectionPreview>;
  saveCollection(id: number, patch: CollectionPatch): Promise<Collection>;
  /** Рассылает команде. Подтверждение — на вызывающем. */
  sendCollection(id: number): Promise<{ delivered: number; intended: number; round: number }>;
  setCollectionClosed(id: number, closed: boolean): Promise<Collection>;
  deleteCollection(id: number): Promise<void>;
  getTemplateRoles(): Promise<TemplateRolesView[]>;
  getTemplateQueue(templateId: number): Promise<TemplateQueue>;
  setRotationUnit(templateId: number, rotationUnit: "day" | "week"): Promise<void>;
  saveTemplateRoles(templateId: number, pool: number[], preference: Record<number, number>): Promise<void>;
  previewRosterImport(csv: string): Promise<RosterImportPreview>;
  applyRosterImport(csv: string, resolutions: RosterPersonResolution[], overwrite?: boolean): Promise<RosterImportSummary & { notified: NotifyReach }>;
  getSettings(): Promise<AdminSettings>;
  setSwapsLock(locked: boolean): Promise<SwapLockResult>;
  /** Кому уйдёт анонс, глазами того, кто его пишет — сервер уже исключил
   *  самого отправителя и архивных. */
  getAnnouncementRecipients(): Promise<AnnouncementRecipient[]>;
  /** Рассылает объявление команде или выбранным. Подтверждение — на
   *  вызывающем, тот же узор, что у `sendCollection`. */
  sendAnnouncement(text: string, audience: AnnouncementAudience): Promise<AnnouncementResult>;
  getBugReports(status: "open" | "all"): Promise<BugReportRow[]>;
  resolveBugReport(id: number, resolved: boolean): Promise<{ id: number; resolvedAt: string | null }>;
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
// `AuthRequiredError` и `OFFLINE_MESSAGE` переехали в пакет; реэкспорт — чтобы
// у экранов, которые их ловят и показывают, не поменялись импорты.
export { AuthRequiredError, OFFLINE_MESSAGE };

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

/**
 * Тот же вход, но в виде, который понимает общий транспорт из `@planer/client`.
 *
 * Ничего не переписано: оба способа входа — `#token=` из ссылки бота и
 * Telegram initData — остались в `requestToken`/`storedToken` выше, а `clear`
 * это прежний `clearAuth`, который чистит и `tokenPromise`, и localStorage.
 */
const tokenSource = { get: authToken, clear: clearAuth };

const transport = createTransport({ baseUrl: API_BASE, tokenSource });
const readApi = createReadApi(transport);
const employeesApi = createEmployeesApi(transport);

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

async function authorizedDelete<T>(path: string): Promise<T> {
  const token = await authToken();
  const res = await apiFetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw await toError(path, res);
  }
  return (await res.json()) as T;
}

/** Экспортируется ради теста про сетевой сбой — в приложение уходит `apiClient` ниже. */
export const realClient: ApiClient = {
  getMe: () => authorizedGet<Viewer>("/api/me"),

  getEmployees: () => employeesApi.getAdminEmployees(),

  // Консоли из ответа нужны только записи: ростер она рисует из собственного
  // `getEmployees`, а не из этой ручки.
  async getTeamSchedule(from, to) {
    const { shifts } = await readApi.getTeamSchedule(from, to);
    return shifts;
  },

  // `accent` сужается здесь: сервер типизирует его строкой намеренно, а палитре
  // консоли нужен перечислимый тип.
  getTemplates: () => readApi.getTemplates() as Promise<Template[]>,

  async getEvents() {
    const [{ events }, { employees }] = await Promise.all([
      authorizedGet<EventsResponse>("/api/admin/events"),
      employeesApi.getAdminEmployees().then((employees) => ({ employees })),
    ]);
    const namesById = new Map(employees.map((e) => [e.id, e.displayName]));
    return events.map((raw) => toFeedEvent(raw, namesById));
  },

  createEntry: (input) => authorizedPostJson<{ entry: Shift; notified: NotifyReach }>("/api/admin/entries", input),

  updateEntry: (id, input) =>
    authorizedPatchJson<{ entry: Shift; notified: NotifyReach }>(`/api/admin/entries/${id}`, input),

  deleteEntry: (id) => authorizedDelete<{ notified: NotifyReach }>(`/api/admin/entries/${id}`),

  // Методы перечислены, а не спреднуты: у консоли этот домен уже своего имени
  // ручке (`getEmployees` вместо `getAdminEmployees`), и «обращение» она не
  // трогает вовсе. Общий слой несёт объединение, консоль берёт своё.
  createEmployee: (name) => employeesApi.createEmployee(name),
  archiveEmployee: (id) => employeesApi.archiveEmployee(id),
  restoreEmployee: (id) => employeesApi.restoreEmployee(id),
  setEmployeeAdmin: (id, isAdmin) => employeesApi.setEmployeeAdmin(id, isAdmin),
  reorderEmployee: (id, position) => employeesApi.reorderEmployee(id, position),
  setBirthDate: (id, birthDate) => employeesApi.setBirthDate(id, birthDate),
  renameEmployee: (id, displayName) => employeesApi.renameEmployee(id, displayName),
  setEmployeeRestrictions: (id, patch) => employeesApi.setEmployeeRestrictions(id, patch),
  setEmployeeObserver: (id, isObserver) => employeesApi.setEmployeeObserver(id, isObserver),
  getEmployeeInvite: (id, regenerate) => employeesApi.getEmployeeInvite(id, regenerate),

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

  getBirthdayPreview(employeeId) {
    return authorizedGet<CollectionPreview>(`/api/admin/birthdays/${employeeId}/preview`);
  },

  async saveBirthdayRound(employeeId, patch) {
    const { collection } = await authorizedPutJson<{ collection: Collection }>(`/api/admin/birthdays/${employeeId}`, patch);
    return collection;
  },

  async getCollections() {
    const { collections } = await authorizedGet<{ collections: CollectionRow[] }>("/api/admin/collections");
    return collections;
  },

  async createCollection(input) {
    const { collection } = await authorizedPostJson<{ collection: Collection }>("/api/admin/collections", input);
    return collection;
  },

  getCollectionPreview(id) {
    return authorizedGet<CollectionPreview>(`/api/admin/collections/${id}/preview`);
  },

  async saveCollection(id, patch) {
    const { collection } = await authorizedPutJson<{ collection: Collection }>(`/api/admin/collections/${id}`, patch);
    return collection;
  },

  sendCollection(id) {
    // `confirm: true` — сервер не примет рассылку без него, и это осознанно:
    // это единственный вызов, который пишет сразу всем коллегам.
    return authorizedPostJson<{ delivered: number; intended: number; round: number }>(
      `/api/admin/collections/${id}/send`, { confirm: true });
  },

  async setCollectionClosed(id, closed) {
    const { collection } = await authorizedPostJson<{ collection: Collection }>(
      `/api/admin/collections/${id}/close`, { closed });
    return collection;
  },

  async deleteCollection(id) {
    await authorizedDelete(`/api/admin/collections/${id}`);
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
    const { summary, notified } = await authorizedPostJson<{ summary: RosterImportSummary; notified: NotifyReach }>(
      "/api/admin/roster/import/apply",
      { csv, resolutions, overwrite },
    );
    return { ...summary, notified };
  },

  getSettings() {
    return authorizedGet<AdminSettings>("/api/admin/settings");
  },

  setSwapsLock(locked) {
    return authorizedPutJson<SwapLockResult>("/api/admin/settings/swaps-lock", { locked });
  },

  async getAnnouncementRecipients() {
    const { recipients } = await authorizedGet<{ recipients: AnnouncementRecipient[] }>("/api/announcements/recipients");
    return recipients;
  },

  sendAnnouncement: (text, audience) =>
    authorizedPostJson<AnnouncementResult>("/api/announcements", { text, audience }),

  async getBugReports(status) {
    const { reports } = await authorizedGet<{ reports: BugReportRow[] }>(`/api/admin/bug-reports?status=${status}`);
    return reports;
  },
  resolveBugReport: (id, resolved) =>
    authorizedPostJson<{ id: number; resolvedAt: string | null }>(`/api/admin/bug-reports/${id}/resolve`, { resolved }),
};

const devClient: ApiClient = {
  getMe: async () => ({ id: 1, displayName: "Админов Админ", address: "Админ" }),

  getEmployees: () => employeesMock.getAdminEmployees(),
  getTeamSchedule: (from, to) => mockGetTeamSchedule(from, to),
  getTemplates: () => mockGetTemplates(),
  getEvents: () => mockGetEvents(),
  createEntry: (input) => mockCreateEntry(input),
  updateEntry: (id, input) => mockUpdateEntry(id, input),
  deleteEntry: (id) => mockDeleteEntry(id),
  createEmployee: (name) => employeesMock.createEmployee(name),
  archiveEmployee: (id) => employeesMock.archiveEmployee(id),
  restoreEmployee: (id) => employeesMock.restoreEmployee(id),
  setEmployeeAdmin: (id, isAdmin) => employeesMock.setEmployeeAdmin(id, isAdmin),
  renameEmployee: (id, displayName) => employeesMock.renameEmployee(id, displayName),
  setBirthDate: (id, birthDate) => employeesMock.setBirthDate(id, birthDate),
  setEmployeeRestrictions: (id, patch) => employeesMock.setEmployeeRestrictions(id, patch),
  setEmployeeObserver: (id, isObserver) => employeesMock.setEmployeeObserver(id, isObserver),
  reorderEmployee: (id, position) => employeesMock.reorderEmployee(id, position),
  getEmployeeInvite: (id, regenerate) => employeesMock.getEmployeeInvite(id, regenerate),
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
  getBirthdayPreview: (employeeId) => mockGetBirthdayPreview(employeeId),
  saveBirthdayRound: (employeeId, patch) => mockSaveBirthdayRound(employeeId, patch),
  getCollections: () => mockGetCollections(),
  createCollection: (input) => mockCreateCollection(input),
  getCollectionPreview: (id) => mockGetCollectionPreview(id),
  saveCollection: (id, patch) => mockSaveCollection(id, patch),
  sendCollection: (id) => mockSendCollection(id),
  setCollectionClosed: (id, closed) => mockSetCollectionClosed(id, closed),
  deleteCollection: (id) => mockDeleteCollection(id),
  getTemplateRoles: () => mockGetTemplateRoles(),
  getTemplateQueue: (templateId) => mockGetTemplateQueue(templateId),
  setRotationUnit: (templateId, unit) => mockSetRotationUnit(templateId, unit),
  saveTemplateRoles: (templateId, pool, preference) => mockSaveTemplateRoles(templateId, pool, preference),
  previewRosterImport: (csv) => mockPreviewRosterImport(csv),
  applyRosterImport: (csv, resolutions, overwrite) => mockApplyRosterImport(csv, resolutions, overwrite),
  getSettings: () => mockGetSettings(),
  setSwapsLock: (locked) => mockSetSwapsLock(locked),
  getAnnouncementRecipients: () => mockGetAnnouncementRecipients(),
  sendAnnouncement: (text, audience) => mockSendAnnouncement(text, audience),
  getBugReports: (status) => mockGetBugReports(status),
  resolveBugReport: (id, resolved) => mockResolveBugReport(id, resolved),
};

/**
 * In dev, short-circuits to realistic mock data so the app renders with no
 * backend running. In production, authenticates via Telegram initData and
 * talks to the real API at `VITE_API_BASE`.
 */
export const apiClient: ApiClient = import.meta.env.DEV ? devClient : realClient;
