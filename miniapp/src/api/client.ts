import { initDataRaw, restoreInitData } from "@telegram-apps/sdk-react";
import { createEmployeesApi, createReadApi, createTransport } from "@planer/client";
import type {
  AdminEmployeeDto,
  CreateEmployeeResponse,
  ScheduleEntryDto,
  TeamScheduleResponse,
  TemplateDto,
} from "@planer/shared";
import type { Category, TemplateAccent } from "../categories";
import {
  mockAcceptSwap,
  mockCancelSwap,
  mockDeclineSwap,
  mockGetMe,
  mockSetRemindersEnabled,
  mockSetSelfScheduleEnabled,
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
  mockGetTemplates,
  mockCreateEntry,
  mockCreateEntries,
  mockUpdateEntry,
  mockDeleteEntry,
  mockCreateSelfEntry,
  mockUpdateSelfEntry,
  mockDeleteSelfEntry,
  mockOfferHandover,
  mockSkipHandover,
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
  mockGetBirthdayPreview,
  mockSaveBirthdayRound,
  mockGetCollections,
  mockCreateCollection,
  mockGetCollectionPreview,
  mockSaveCollection,
  mockSendCollection,
  mockSetCollectionClosed,
  mockDeleteCollection,
  mockGetMyCollections,
  mockGetTemplateRoles,
  mockGetTemplateQueue,
  mockSetRotationUnit,
  mockSaveTemplateRoles,
  mockGetRosterCsv,
  mockPreviewRosterImport,
  mockApplyRosterImport,
  mockGetSettings,
  mockSetSwapsLock,
  mockGetNoticePrefs,
  mockSetNoticePref,
  mockSendAnnouncement,
  mockGetAnnouncementRecipients,
  mockGetBugReports,
  mockResolveBugReport,
  employeesMock,
} from "./mock";

/**
 * Запись графика: смена, дежурство или (возможно многодневное) отсутствие.
 *
 * Это DTO из контракта плюс одно поле сверху. Раньше форма была объявлена здесь
 * своими словами и успела разойтись с сервером: `unrecognisedCode` значился
 * необязательным, хотя сервер отдаёт его всегда, пусть и `null`.
 */
export type Shift = ScheduleEntryDto & {
  /**
   * Не поле сервера: мини-апп приклеивает имя сам, соединяя записи с ростером
   * из того же ответа `/api/team/schedule` (id -> displayName).
   * Заполняет только `getTeamSchedule`; у `getMyShifts` остаётся `undefined`,
   * потому что там каждая запись и так принадлежит спрашивающему.
   */
  employeeName?: string;
};

export interface TeamEmployee {
  id: number;
  displayName: string;
  rosterOrder: number | null;
  /** The EFFECTIVE value (`shared/access.ts`'s `canSwap`) — always `true` for
   *  an observer even if the underlying flag in the database is off. The
   *  propose-swap candidate list must not offer them, and the "Обменять"
   *  screen shouldn't count them as a duplicate. */
  excludedFromSwaps: boolean;
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
  /** Admin's global «Обменять» switch — the screen must grey the button out
   *  rather than show it live and get refused on tap. */
  swapsLocked: boolean;
  /** Admin took this person specifically out of swaps — always `true` here for
   *  an observer, even if the underlying flag in the database is off: this is
   *  the EFFECTIVE value (`shared/access.ts`'s `canSwap`), and the UI never has
   *  to know the role exists to grey the «Обменять» button out for one. */
  excludedFromSwaps: boolean;
  /** Роль «Наблюдатель»: смотрит график, ведёт свой (если включил тумблер),
   *  шлёт анонсы — вне раздачи, обменов и передачи смен. См. `access.ts`. */
  isObserver: boolean;
  /** Личный тумблер наблюдателя «Веду свой график сам». У обычного работника
   *  всегда `false` — сервер не читает эту колонку для чужой роли. */
  selfScheduleEnabled: boolean;
  /** Видна ли этому человеку вкладка «Анонс» — `isAdmin || isObserver`
   *  (`canAnnounce` в `access.ts`), уже посчитано сервером, чтобы клиент не
   *  дублировал правило. */
  canAnnounce: boolean;
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
  /** Смена это или дежурство. С 2026-08-10 меняться можно и дежурствами, а
   *  `title` у части записей пуст — тогда назвать вид записи можно только по
   *  категории, и карточка иначе молчала бы именно там, где решение и
   *  принимается. */
  category: Category;
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

/**
 * Работник — DTO из контракта.
 *
 * Форма была объявлена здесь своими словами; на переезде выяснилось, что три
 * ручки домена её не выполняли — отдавали ряд таблицы и не отдавали `address`,
 * который тут объявлен `string`. Теперь тип один на сервер и на оба фронта.
 */
export type Employee = AdminEmployeeDto;

/** A saved shift preset the add-entry form can offer, with Friday-shortened times. */
/**
 * Пресет смены — форма из контракта, с одним сужением.
 *
 * Поля брались отсюда же до переезда на `@planer/client`, но два из них врали:
 * `fridayStart`/`fridayEnd` объявлялись `string`, а колонка в базе допускает
 * `null` — то есть первый же пресет без пятничных часов уронил бы экран.
 *
 * `accent` наоборот сужен против контракта: сервер отдаёт строку намеренно
 * (новый цвет в базе не должен ронять контракт), а экраны индексируют по нему
 * палитру, и им нужен именно перечислимый тип.
 */
export interface Template extends Omit<TemplateDto, "accent"> {
  accent: TemplateAccent;
}

/** Ответ создания работника: он сам, токен приглашения и готовая ссылка. */
export type CreateEmployeeResult = CreateEmployeeResponse;

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

/**
 * Тело самозаписи работника — зеркало `selfEntryBody` из `my-entries.ts`.
 *
 * `employeeId` здесь нет, и это не упущение: сервер берёт его из токена, а
 * поля, которого нет в схеме, не подставишь. Объединение по категории, а не
 * `NewEntryInput`: та принимает `templateId`, `employeeId` и все семь категорий,
 * и любое её будущее расширение молча расширило бы права работника.
 */
export type SelfEntryInput =
  | { category: "sick_leave"; date: string; endDate?: string | null }
  | { category: "offsite"; date: string; start: string; end: string; title: string; location?: string | null }
  // Собственная смена наблюдателя — третья форма, зеркалит `shiftBody` на
  // сервере. Без `title`: смена не мероприятие, называть её нечем и незачем.
  | { category: "shift"; date: string; start: string; end: string; location?: string | null };

/**
 * Смена, оставшаяся без человека из-за больничного, и кому её можно предложить.
 *
 * Кандидатов считает сервер: экран, предлагающий коллегу, которому сервер
 * откажет, — дефект, который человек встречает уже после нажатия.
 */
export interface HandoverDraft {
  id: number;
  /** «Ср 12 авг · 09:00–18:00 · День» — той же функцией, что и во всех письмах. */
  shiftLine: string;
  candidates: { id: number; displayName: string }[];
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

/** Один вид админского письма и его тумблер — экран «Настройки» → «Что мне писать». */
export interface NoticePref {
  kind: string;
  title: string;
  hint: string;
  enabled: boolean;
}

export interface NoticePrefs {
  kinds: NoticePref[];
}

/** Зеркалит `ANNOUNCEMENT_TEXT_MAX` из `server/src/announcements/announcement-service.ts`.
 *  Не импортируется оттуда: тот модуль тянет `grammy`, серверную зависимость,
 *  которой не место в бандле мини-аппа. Разойдись значения — счётчик соврёт на
 *  пару символов, но 400 всё равно решает сервер; здесь только подсказка. */
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
 *  Без телефонов и инвайт-токенов: экрану «Анонс» нужны ровно имя и «дойдёт ли». */
export interface AnnouncementRecipient {
  id: number;
  displayName: string;
  reachable: boolean;
}

/** Один багрепорт списком — ради этого экрана и заводилась таблица: в чате
 *  сообщение тонет за сутки, здесь остаётся, пока его не отметят «Разобрал». */
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
  absence: Category | null;
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

/** A slot the pass walked past: nobody in its pool is still on the roster
 *  (`empty_pool` — a setting to fix), or everyone eligible was busy or away
 *  (`nobody_free` — just the week). */
export interface UnfilledSlot {
  shiftId: number;
  date: string;
  kind: string;
  reason: "empty_pool" | "nobody_free";
}

/** Result of `POST /api/admin/distribute`: whether it was applied, the chosen
 *  assignments, and the slots it could not fill. */
export interface DistributeResult {
  applied: boolean;
  assignments: DistributionAssignment[];
  unfilled: UnfilledSlot[];
  notified: NotifyReach;
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

/** Активный сбор глазами работника — то, что видно во вкладке «Команда». */
export interface WorkerCollection {
  id: number;
  title: string;
  personName: string | null;
  collectUrl: string | null;
  amountPerPerson: number | null;
  totalGoal: number | null;
  deadline: string | null;
  eventDate: string | null;
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
  campaign: Collection | null;
}

/**
 * Всё, что нужно при открытии, одним ответом.
 *
 * Не «ещё один способ прочитать то же» — а способ не платить за семь соединений.
 * Мини-апп открывают через облачный релей KeenDNS, у которого измеренное
 * TLS-рукопожатие 1.5–6.8 с на каждое новое соединение и только HTTP/1.1.
 */
export interface Bootstrap {
  me: Me;
  myShifts: { shifts: Shift[]; today: string };
  teamSchedule: TeamSchedule;
  templates: Template[];
  swaps: SwapRequest[];
  weekendSlots: WeekendSlotView[];
  weekendOffers: WeekendOffer[];
}

export interface ApiClient {
  getBootstrap(from: string, to: string): Promise<Bootstrap>;
  getMe(): Promise<Me>;
  /** Turns this person's own shift reminders on or off. */
  setRemindersEnabled(enabled: boolean): Promise<boolean>;
  /** Тумблер наблюдателя «Веду свой график сам» — 403 у обычного работника,
   *  сервер проверяет `isObserver` сам, экран сюда его и не подпускает. */
  setSelfScheduleEnabled(enabled: boolean): Promise<boolean>;
  /** `null` clears it and hands the greeting back to Telegram's name. */
  setPreferredName(preferredName: string | null): Promise<{ preferredName: string | null; address: string }>;
  getMyShifts(): Promise<{ shifts: Shift[]; today: string }>;
  getTeamSchedule(from: string, to: string): Promise<TeamSchedule>;
  getSwaps(): Promise<SwapRequest[]>;
  proposeSwap(fromShiftId: number, toShiftId: number, message?: string): Promise<SwapRequest>;
  acceptSwap(id: number): Promise<void>;
  declineSwap(id: number): Promise<void>;
  cancelSwap(id: number): Promise<void>;
  /**
   * Больничный или мероприятие себе. Отказ приезжает `Error`'ом с русской фразой
   * правила. Вместе с записью возвращаются смены, оставшиеся без человека, —
   * форма спрашивает про них вторым шагом.
   */
  createSelfEntry(input: SelfEntryInput): Promise<{ entry: Shift; handovers: HandoverDraft[] }>;
  updateSelfEntry(id: number, input: SelfEntryInput): Promise<Shift>;
  deleteSelfEntry(id: number): Promise<void>;
  /** «Предложить Игорю» — адресно одному коллеге. */
  offerHandover(handoverId: number, toEmployeeId: number): Promise<void>;
  /** «Потом» — сразу всем свободным, чтобы смена не осталась молча на больном. */
  skipHandover(handoverId: number): Promise<void>;
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
  /** Sets one or both exclusion flags. Turning on `excludedFromSwaps` cancels
   *  this person's open swap requests and notifies them — the caller doesn't
   *  need to do anything else for that to happen. */
  setEmployeeRestrictions(id: number, patch: { excludedFromAssignment?: boolean; excludedFromSwaps?: boolean }): Promise<void>;
  /** Роль «Наблюдатель»: смотрит график, ведёт свой, шлёт анонсы — вне
   *  раздачи, обменов и передачи смен. Снятие роли не переписывает
   *  `excludedFromAssignment`/`excludedFromSwaps` — админ должен видеть, куда
   *  человек вернётся. */
  setEmployeeObserver(id: number, isObserver: boolean): Promise<void>;
  /** Move a worker to `position` (1-based). The server renumbers the rest. */
  reorderEmployee(id: number, position: number): Promise<Employee[]>;
  /** (Re)issue the invite link for a worker who hasn't linked Telegram yet. */
  getEmployeeInvite(id: number, regenerate?: boolean): Promise<{ inviteToken: string; inviteLink: string | null }>;
  getTemplates(): Promise<Template[]>;
  createEntry(input: NewEntryInput): Promise<{ entry: Shift; notified: NotifyReach }>;
  /** Одним запросом вместо цикла — «Заполнить неделю» писала бы письмо на каждый
   *  день иначе. Один POST, одно письмо на человека независимо от числа дней. */
  createEntries(inputs: NewEntryInput[]): Promise<{ created: number; notified: NotifyReach }>;
  updateEntry(id: number, input: NewEntryInput): Promise<{ entry: Shift; notified: NotifyReach }>;
  deleteEntry(id: number): Promise<{ notified: NotifyReach }>;
  distribute(from: string, to: string, apply: boolean): Promise<DistributeResult>;
  getAdminWeekendSlots(): Promise<AdminSlotView[]>;
  /** The slot, plus how many of the team the «нужен человек» broadcast reached —
   *  only people who linked Telegram can be told at all. */
  postSlot(input: NewSlotInput): Promise<VacantSlot & { delivered: number; intended: number }>;
  assignSlot(slotId: number, employeeId: number): Promise<void>;
  unassignSlot(assignmentId: number): Promise<void>;
  getPayroll(from: string, to: string): Promise<PayrollRow[]>;
  getPayrollCsv(from: string, to: string): Promise<string>;
  getShiftCounts(from: string, to: string): Promise<ShiftCountsReport>;
  getJournal(params: { types?: string[]; actor?: number; limit?: number; offset?: number }): Promise<JournalPage>;
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
  /** Активные чужие сборы, уже разосланные команде — вкладка «Команда». Не для админов-скринов. */
  getMyCollections(): Promise<WorkerCollection[]>;
  getTemplateRoles(): Promise<TemplateRolesView[]>;
  getTemplateQueue(templateId: number): Promise<TemplateQueue>;
  setRotationUnit(templateId: number, rotationUnit: "day" | "week"): Promise<void>;
  saveTemplateRoles(templateId: number, pool: number[], preference: Record<number, number>): Promise<void>;
  getRosterCsv(from: string, to: string): Promise<string>;
  previewRosterImport(csv: string): Promise<RosterImportPreview>;
  applyRosterImport(csv: string, resolutions: RosterPersonResolution[], overwrite?: boolean): Promise<RosterImportSummary & { notified: NotifyReach }>;
  getSettings(): Promise<AdminSettings>;
  setSwapsLock(locked: boolean): Promise<SwapLockResult>;
  getNoticePrefs(): Promise<NoticePrefs>;
  setNoticePref(kind: string, enabled: boolean): Promise<{ kind: string; enabled: boolean }>;
  /** Рассылает произвольный текст команде. Превью — на вызывающем: сервер его
   *  не даёт, текст анонса и так ровно тот, что напечатал админ или наблюдатель. */
  sendAnnouncement(text: string, audience: AnnouncementAudience): Promise<AnnouncementResult>;
  /** Кому уйдёт анонс «всем», глазами того, кто его пишет — для выбора адресатов. */
  getAnnouncementRecipients(): Promise<AnnouncementRecipient[]>;
  getBugReports(status: "open" | "all"): Promise<BugReportRow[]>;
  /** Переключатель, а не одноразовое действие — как «Собрали, закрыть» у сборов. */
  resolveBugReport(id: number, resolved: boolean): Promise<{ id: number; resolvedAt: string | null }>;
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
  /** Pending swaps this import invalidated — people had open requests on entries
   *  the file replaced, and were told so. */
  swapsExpired: number;
  unknowns: RosterUnknownCell[];
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
  try {
    restoreInitData();
  } catch {
    // No launch params available (e.g. opened outside Telegram). Fall
    // through and let the /api/auth call below fail with a clear 401
    // rather than hanging on a signal that will never populate.
  }
  const res = await apiFetch(`${API_BASE}/api/auth`, {
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

/**
 * Тот же токен, но в виде, который понимает общий транспорт из `@planer/client`.
 *
 * Логика входа не переписана: `restoreInitData` + `initDataRaw` остались в
 * `requestToken` выше. Новое здесь только `clear` — до переезда мини-апп не
 * сбрасывал протухший токен вообще, и после 401 продолжал ходить с ним же.
 */
const tokenSource = {
  get: authToken,
  clear: () => {
    tokenPromise = null;
  },
};

const transport = createTransport({ baseUrl: API_BASE, tokenSource });
const readApi = createReadApi(transport);
const employeesApi = createEmployeesApi(transport);

/**
 * Приклеивает имя работника к записи, соединяя её с ростером из того же ответа.
 *
 * Живёт здесь, а не в моке и не на сервере, по двум причинам. Сервер имени не
 * отдаёт — записи и ростер приезжают одним ответом, и join дешевле повторения
 * имени в каждой строке. А мок раньше запекал имя в фикстуру, из-за чего
 * dev-путь и живой путь расходились ровно тем полем, которого в контракте нет.
 * Теперь оба зовут это.
 */
function withEmployeeNames(schedule: TeamScheduleResponse): TeamSchedule {
  const nameById = new Map(schedule.employees.map((employee) => [employee.id, employee.displayName]));
  return {
    employees: schedule.employees,
    shifts: schedule.shifts.map((shift) => ({
      ...shift,
      employeeName: shift.employeeId != null ? nameById.get(shift.employeeId) : undefined,
    })),
  };
}

async function authorizedGet<T>(path: string): Promise<T> {
  const token = await authToken();
  const res = await apiFetch(`${API_BASE}${path}`, {
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
  const res = await apiFetch(`${API_BASE}${path}`, {
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
  const res = await apiFetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await errorMessage(path, res));
  }
}

async function authorizedPatchJson<T>(path: string, payload: unknown): Promise<T> {
  const token = await authToken();
  const res = await apiFetch(`${API_BASE}${path}`, {
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
  const res = await apiFetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(path, res));
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
    throw new Error(await errorMessage(path, res));
  }
  return (await res.json()) as T;
}

/** Fetches and maps `GET /api/swaps` to the enriched UI shape. Shared by
 * `getSwaps` and `proposeSwap` (the latter re-fetches to get the freshly
 * created request's enriched view, since `POST /api/swaps` only echoes the raw row). */
async function fetchSwaps(): Promise<SwapRequest[]> {
  const { swaps } = await authorizedGet<SwapsResponse>("/api/swaps");
  return swaps.map(toSwapRequest);
}

export const realClient: ApiClient = {
  async getBootstrap(from, to) {
    const raw = await authorizedGet<{
      me: Me;
      myShifts: { shifts: Shift[]; today: string };
      teamSchedule: TeamSchedule;
      templates: { templates: Template[] };
      swaps: { swaps: SwapRequest[] };
      weekendSlots: { slots: WeekendSlotView[] };
      weekendOffers: { offers: WeekendOffer[] };
    }>(`/api/bootstrap?from=${from}&to=${to}`);
    // Части приходят в тех же обёртках, что у одиночных ручек, — распаковка
    // здесь, чтобы экраны видели ровно те же формы, что и раньше.
    return {
      me: raw.me,
      myShifts: raw.myShifts,
      teamSchedule: raw.teamSchedule,
      templates: raw.templates.templates,
      swaps: raw.swaps.swaps,
      weekendSlots: raw.weekendSlots.slots,
      weekendOffers: raw.weekendOffers.offers,
    };
  },

  getMe: () => authorizedGet<Me>("/api/me"),

  async setRemindersEnabled(enabled) {
    const res = await authorizedPatchJson<{ remindersEnabled: boolean }>("/api/me/settings", { remindersEnabled: enabled });
    return res.remindersEnabled;
  },

  async setSelfScheduleEnabled(enabled) {
    // `/api/me/settings` эхает обратно `remindersEnabled`/`preferredName`/`address`
    // — общий ответ на три разных поля, и `selfScheduleEnabled` среди них нет.
    // 200 здесь и есть подтверждение: отказ (не наблюдатель) пришёл бы `Error`'ом
    // из `authorizedPatchJson`, и до `return` дело не дошло бы.
    await authorizedPatchJson("/api/me/settings", { selfScheduleEnabled: enabled });
    return enabled;
  },

  setPreferredName: (preferredName) =>
    authorizedPatchJson<{ preferredName: string | null; address: string }>("/api/me/settings", { preferredName }),

  // `from` не передаётся намеренно: сервер сам возьмёт сегодняшний день команды.
  getMyShifts: () => readApi.getMyShifts(),

  getTeamSchedule: async (from, to) => withEmployeeNames(await readApi.getTeamSchedule(from, to)),

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

  async createSelfEntry(input) {
    const res = await authorizedPostJson<{ entry: Shift; handovers?: HandoverDraft[] }>("/api/my/entries", input);
    return { entry: res.entry, handovers: res.handovers ?? [] };
  },
  async offerHandover(handoverId, toEmployeeId) {
    await authorizedPostJson(`/api/my/handovers/${handoverId}/offer`, { toEmployeeId });
  },
  async skipHandover(handoverId) {
    await authorizedPostJson(`/api/my/handovers/${handoverId}/skip`, {});
  },
  async updateSelfEntry(id, input) {
    const { entry } = await authorizedPatchJson<{ entry: Shift }>(`/api/my/entries/${id}`, input);
    return entry;
  },
  async deleteSelfEntry(id) {
    await authorizedDelete<{ ok: true }>(`/api/my/entries/${id}`);
  },

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
  ...employeesApi,

  // `accent` сужается здесь: сервер типизирует его строкой, палитра экранов —
  // перечислением. Незнакомый цвет рисуется запасным, см. `categories.ts`.
  getTemplates: () => readApi.getTemplates() as Promise<Template[]>,

  createEntry: (input) => authorizedPostJson<{ entry: Shift; notified: NotifyReach }>("/api/admin/entries", input),
  createEntries: (inputs) =>
    authorizedPostJson<{ created: number; notified: NotifyReach }>("/api/admin/entries/bulk", { entries: inputs }),
  updateEntry: (id, input) =>
    authorizedPatchJson<{ entry: Shift; notified: NotifyReach }>(`/api/admin/entries/${id}`, input),
  deleteEntry: (id) => authorizedDelete<{ notified: NotifyReach }>(`/api/admin/entries/${id}`),

  distribute: (from, to, apply) =>
    authorizedPostJson<DistributeResult>("/api/admin/distribute", { from, to, apply }),

  async getAdminWeekendSlots() {
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
    // Unlike every other admin call this returns raw CSV text, not JSON — the
    // screen wraps it in a Blob + download link (see `AdminWeekendScreen`).
    const token = await authToken();
    const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await apiFetch(`${API_BASE}/api/admin/weekend/payroll.csv?${q}`, {
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

  async getMyCollections() {
    const { collections } = await authorizedGet<{ collections: WorkerCollection[] }>("/api/collections");
    return collections;
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
    if (!res.ok) throw new Error(await errorMessage(path, res));
  },

  async saveTemplateRoles(templateId, pool, preference) {
    const token = await authToken();
    const path = `/api/admin/templates/${templateId}/roles`;
    const res = await apiFetch(`${API_BASE}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pool, preference }),
    });
    if (!res.ok) throw new Error(await errorMessage(path, res));
  },

  async getRosterCsv(from, to) {
    const token = await authToken();
    const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await apiFetch(`${API_BASE}/api/admin/roster.csv?${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await errorMessage("/api/admin/roster.csv", res));
    return res.text();
  },

  previewRosterImport: (csv) =>
    authorizedPostJson<RosterImportPreview>("/api/admin/roster/import/preview", { csv }),

  async applyRosterImport(csv, resolutions, overwrite = false) {
    const { summary, notified } = await authorizedPostJson<{ summary: RosterImportSummary; notified: NotifyReach }>(
      "/api/admin/roster/import/apply",
      { csv, resolutions, overwrite },
    );
    return { ...summary, notified };
  },

  getSettings: () => authorizedGet<AdminSettings>("/api/admin/settings"),
  setSwapsLock: (locked) => authorizedPutJson<SwapLockResult>("/api/admin/settings/swaps-lock", { locked }),
  getNoticePrefs: () => authorizedGet<NoticePrefs>("/api/me/notifications"),
  setNoticePref: (kind, enabled) =>
    authorizedPatchJson<{ kind: string; enabled: boolean }>("/api/me/notifications", { kind, enabled }),
  sendAnnouncement: (text, audience) =>
    authorizedPostJson<AnnouncementResult>("/api/announcements", { text, audience }),
  async getAnnouncementRecipients() {
    const { recipients } = await authorizedGet<{ recipients: AnnouncementRecipient[] }>("/api/announcements/recipients");
    return recipients;
  },
  async getBugReports(status) {
    const { reports } = await authorizedGet<{ reports: BugReportRow[] }>(`/api/admin/bug-reports?status=${status}`);
    return reports;
  },
  resolveBugReport: (id, resolved) =>
    authorizedPostJson<{ id: number; resolvedAt: string | null }>(`/api/admin/bug-reports/${id}/resolve`, { resolved }),
};

const devClient: ApiClient = {
  async getBootstrap(from, to) {
    // Через СВОИ ЖЕ методы, а не напрямую в мок-функции. Иначе подмена одной
    // ручки (`vi.spyOn(apiClient, "getMyShifts")`) перестаёт влиять на старт, и
    // экранные тесты начинают видеть данные дев-ростера вместо своей фикстуры —
    // ровно это и случилось на четырёх тестах, когда старт стал одним запросом.
    const [me, myShifts, teamSchedule, templates, swaps, weekendSlots, weekendOffers] = await Promise.all([
      this.getMe(), this.getMyShifts(), this.getTeamSchedule(from, to), this.getTemplates(),
      this.getSwaps(), this.getWeekendSlots(), this.getWeekendOffers(),
    ]);
    return { me, myShifts, teamSchedule, templates, swaps, weekendSlots, weekendOffers };
  },

  getMe: () => mockGetMe(),
  setRemindersEnabled: (enabled) => mockSetRemindersEnabled(enabled),
  setSelfScheduleEnabled: (enabled) => mockSetSelfScheduleEnabled(enabled),
  setPreferredName: (preferredName) => mockSetPreferredName(preferredName),
  getMyShifts: () => mockGetMyShifts(),
  getTeamSchedule: async (from, to) => withEmployeeNames(await mockGetTeamSchedule(from, to)),
  getSwaps: () => mockGetSwaps(),
  proposeSwap: (fromShiftId, toShiftId, message) => mockProposeSwap(fromShiftId, toShiftId, message),
  acceptSwap: (id) => mockAcceptSwap(id),
  declineSwap: (id) => mockDeclineSwap(id),
  cancelSwap: (id) => mockCancelSwap(id),
  createSelfEntry: (input) => mockCreateSelfEntry(input),
  updateSelfEntry: (id, input) => mockUpdateSelfEntry(id, input),
  deleteSelfEntry: (id) => mockDeleteSelfEntry(id),
  offerHandover: (handoverId, toEmployeeId) => mockOfferHandover(handoverId, toEmployeeId),
  skipHandover: (handoverId) => mockSkipHandover(handoverId),
  getWeekendSlots: () => mockGetWeekendSlots(),
  expressInterest: (slotId) => mockExpressInterest(slotId),
  getWeekendOffers: () => mockGetWeekendOffers(),
  confirmOffer: (id) => mockConfirmOffer(id),
  declineOffer: (id) => mockDeclineOffer(id),

  ...employeesMock,
  getTemplates: () => mockGetTemplates(),
  createEntry: (input) => mockCreateEntry(input),
  createEntries: (inputs) => mockCreateEntries(inputs),
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
  getBirthdayPreview: (employeeId) => mockGetBirthdayPreview(employeeId),
  saveBirthdayRound: (employeeId, patch) => mockSaveBirthdayRound(employeeId, patch),
  getCollections: () => mockGetCollections(),
  createCollection: (input) => mockCreateCollection(input),
  getCollectionPreview: (id) => mockGetCollectionPreview(id),
  saveCollection: (id, patch) => mockSaveCollection(id, patch),
  sendCollection: (id) => mockSendCollection(id),
  setCollectionClosed: (id, closed) => mockSetCollectionClosed(id, closed),
  deleteCollection: (id) => mockDeleteCollection(id),
  getMyCollections: () => mockGetMyCollections(),
  getTemplateRoles: () => mockGetTemplateRoles(),
  getTemplateQueue: (templateId) => mockGetTemplateQueue(templateId),
  setRotationUnit: (templateId, unit) => mockSetRotationUnit(templateId, unit),
  saveTemplateRoles: (templateId, pool, preference) => mockSaveTemplateRoles(templateId, pool, preference),
  getRosterCsv: (from, to) => mockGetRosterCsv(from, to),
  previewRosterImport: (csv) => mockPreviewRosterImport(csv),
  applyRosterImport: (csv, resolutions, overwrite) => mockApplyRosterImport(csv, resolutions, overwrite),
  getSettings: () => mockGetSettings(),
  setSwapsLock: (locked) => mockSetSwapsLock(locked),
  getNoticePrefs: () => mockGetNoticePrefs(),
  setNoticePref: (kind, enabled) => mockSetNoticePref(kind, enabled),
  sendAnnouncement: (text, audience) => mockSendAnnouncement(text, audience),
  getAnnouncementRecipients: () => mockGetAnnouncementRecipients(),
  getBugReports: (status) => mockGetBugReports(status),
  resolveBugReport: (id, resolved) => mockResolveBugReport(id, resolved),
};

/**
 * In dev, short-circuits to realistic mock data so the app renders with no
 * backend running. In production, authenticates via Telegram initData and
 * talks to the real API at `VITE_API_BASE`.
 */
export const apiClient: ApiClient = import.meta.env.DEV ? devClient : realClient;
