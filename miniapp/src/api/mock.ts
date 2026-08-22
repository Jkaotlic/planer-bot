import { createEmployeesMock, createReadMock } from "@planer/client";
import type { TeamScheduleResponse } from "@planer/shared";
import type { Category } from "../categories";
import type {
  AdminSettings,
  AdminSlotView,
  DistributeResult,
  UnfilledSlot,
  Employee,
  Me,
  NewEntryInput,
  NewEntryRangeInput,
  EntryRangeResult,
  MyChecklist,
  ChecklistItem,
  NewSlotInput,
  PayrollRow,
  RosterImportPreview,
  RosterImportSummary,
  RosterPersonResolution,
  TemplateRolesView,
  TemplateQueue,
  JournalEvent,
  JournalPage,
  Collection,
  CollectionRow,
  CollectionPreview,
  NewCollectionInput,
  CollectionPatch,
  NoticePrefs,
  AnnouncementAudience,
  AnnouncementResult,
  AnnouncementRecipient,
  BugReportRow,
  WorkerCollection,
  UpcomingBirthday,
  ShiftCountsReport,
  HandoverDraft,
  SelfEntryInput,
  Shift,
  SwapDirection,
  SwapLockResult,
  SwapRequest,
  SwapShiftSummary,
  SwapStatus,
  Template,
  VacantSlot,
  WeekendSlotView,
  WeekendOffer,
} from "./client";
import { addDays, mondayOf, toISODate } from "../lib/week";
import {
  rotationQueue,
  describeTurn,
  daysUntilBirthday,
  formatBirthDate,
  outgoingCollectionMessage,
  collectionTitle,
  collectionStatus,
  isCollectionActive,
  compareCollections,
  selfEntryRefusal,
  selfEntryEditRefusal,
  ADMIN_NOTICE_KINDS,
  ADMIN_NOTICE_LABELS,
  planEntryRange,
  eachDayIso,
  isAbsence,
} from "@planer/shared";
import { inviteLinkFor } from "../lib/bot";

/**
 * Realistic sample data for local development (see `client.ts`: every
 * `ApiClient` method short-circuits to this module when `import.meta.env.DEV`
 * is true). Dates are always computed relative to *this week's* Monday, so
 * the screens never go stale.
 */

// The dev caller is an admin so the "Админ" tab is reachable offline — the
// whole point of the mocks is to exercise every screen with no backend. In
// production `me.isAdmin` comes from the server, so this only affects dev.
export const MOCK_ME: Me = {
  id: 1,
  displayName: "Аня Смирнова",
  // Telegram's own first name — deliberately NOT derived from displayName, which
  // in the live roster is «Фамилия Имя». See `addressOf` in @planer/shared.
  address: "Аня",
  preferredName: null,
  isAdmin: true,
  remindersEnabled: true,
  swapsLocked: false,
  excludedFromSwaps: false,
  // Дев-мок всегда админ (см. комментарий выше) — наблюдателя тут не пощупать
  // руками, зато экран, скрытый и от админа, и от наблюдателя, виден сразу.
  isObserver: false,
  selfScheduleEnabled: false,
  canAnnounce: true,
};

export async function mockSetRemindersEnabled(enabled: boolean): Promise<boolean> {
  await delay(200);
  MOCK_ME.remindersEnabled = enabled;
  return enabled;
}

export async function mockSetSelfScheduleEnabled(enabled: boolean): Promise<boolean> {
  await delay(200);
  MOCK_ME.selfScheduleEnabled = enabled;
  return enabled;
}

export async function mockSetPreferredName(preferredName: string | null): Promise<{ preferredName: string | null; address: string }> {
  await delay(200);
  const value = preferredName?.trim() || null;
  MOCK_ME.preferredName = value;
  // Mirrors `addressOf`: chosen name, then Telegram's, then the roster's.
  MOCK_ME.address = value ?? "Аня";
  return { preferredName: value, address: MOCK_ME.address };
}

/**
 * In-memory roster shared by the worker screens (name lookups) and the admin
 * "Работники" screen (full rows). Mutated live by create/archive/restore so
 * both surfaces update without a reload. Ids 1–5 mirror the worker mock's
 * original PEOPLE map; id 6 exercises the archive list and id 7 the active
 * employee-without-shifts state.
 */
const EMPLOYEES: Employee[] = [
  { id: 1, displayName: "Аня Смирнова", isAdmin: true, isActive: true, telegramUserId: 100001, birthDate: "03-14", preferredName: null, address: "Аня Смирнова", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false },
  // Живой пример погашенной кнопки в «Обмены» (см. `mockGetTeamSchedule` ниже,
  // которая теперь читает это же поле, а не отдельный список).
  { id: 2, displayName: "Игорь Петров", isAdmin: false, isActive: true, telegramUserId: 100002, birthDate: "08-05", preferredName: null, address: "Игорь Петров", excludedFromAssignment: false, excludedFromSwaps: true, isObserver: false, selfScheduleEnabled: false },
  { id: 3, displayName: "Марк Волков", isAdmin: false, isActive: true, telegramUserId: null, birthDate: null, preferredName: null, address: "Марк Волков", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false },
  { id: 4, displayName: "Даша Кузнецова", isAdmin: false, isActive: true, telegramUserId: 100004, birthDate: "12-31", preferredName: null, address: "Даша Кузнецова", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false },
  { id: 5, displayName: "Олег Соколов", isAdmin: false, isActive: true, telegramUserId: 100005, birthDate: null, preferredName: null, address: "Олег Соколов", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false },
  { id: 6, displayName: "Света Орлова", isAdmin: false, isActive: false, telegramUserId: 100006, birthDate: null, preferredName: null, address: "Света Орлова", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false },
  { id: 7, displayName: "Нина Белова", isAdmin: false, isActive: true, telegramUserId: 100007, birthDate: "02-29", preferredName: null, address: "Нина Белова", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false },
];

function personName(employeeId: number): string {
  return EMPLOYEES.find((e) => e.id === employeeId)?.displayName ?? "Без имени";
}

const MONDAY = mondayOf(new Date());
/** ISO date for "Monday + offset days" of the current week. */
function dayIso(offsetFromMonday: number): string {
  return toISODate(addDays(MONDAY, offsetFromMonday));
}

interface EntryDraft {
  unrecognisedCode?: string | null;
  templateId?: number | null;
  date: string;
  start: string | null;
  end: string | null;
  endDate: string | null;
  category: Category;
  title: string | null;
  location?: string | null;
  employeeId: number | null;
}

let nextId = 1;
function entry(draft: EntryDraft): Shift {
  return {
    id: nextId++,
    employeeName: draft.employeeId != null ? personName(draft.employeeId) : undefined,
    ...draft,
    templateId: draft.templateId ?? null,
    location: draft.location ?? null,
    unrecognisedCode: draft.unrecognisedCode ?? null,
  };
}

// A full week across a six-person active roster (Пн=0 .. Вс=6). Аня (id 1) is the
// caller — her entries double as "my shifts" and appear in the team view.
// Mutable: the admin schedule screen's create/update/delete/distribute
// mutators operate on this same array so the team/my views reflect edits
// without a reload.
// Preset-backed entries carry their `templateId` (see TEMPLATES below), which is
// what colours them per-preset; the ones deliberately left without it — absences,
// a custom-place duty, an offsite — exercise the fallback to the category colour.
const ALL_ENTRIES: Shift[] = [
  // Пн
  entry({ templateId: 1, date: dayIso(0), start: "08:00", end: "17:00", endDate: null, category: "shift", title: "Утро", employeeId: 1 }),
  entry({ templateId: 1, date: dayIso(0), start: "08:00", end: "17:00", endDate: null, category: "shift", title: "Утро", employeeId: 2 }),
  entry({ templateId: 2, date: dayIso(0), start: "09:00", end: "18:00", endDate: null, category: "shift", title: "День", employeeId: 4 }),
  entry({
    templateId: 6,
    date: dayIso(0),
    start: "07:00",
    end: "16:00",
    endDate: null,
    category: "duty",
    title: "Дежурство с 07:00",
    employeeId: 3,
  }),
  entry({ templateId: 3, date: dayIso(0), start: "11:00", end: "20:00", endDate: null, category: "shift", title: "Вечер", employeeId: 5 }),
  entry({ date: dayIso(0), start: null, end: null, endDate: dayIso(2), category: "vacation", title: null, employeeId: 2 }),
  entry({
    templateId: 5,
    date: dayIso(0),
    start: "09:00",
    end: "18:00",
    endDate: dayIso(1),
    category: "duty",
    title: "Дежурство · Поклонка",
    location: "Поклонка",
    employeeId: 4,
  }),

  // Вт–Ср: Игорь в командировке (один интервал, показывается в оба дня)
  entry({ date: dayIso(1), start: null, end: null, endDate: dayIso(2), category: "business_trip", title: null, employeeId: 2 }),
  // Вт
  entry({ templateId: 2, date: dayIso(1), start: "12:00", end: "21:00", endDate: null, category: "shift", title: "День", employeeId: 3 }),
  entry({ templateId: 3, date: dayIso(1), start: "17:00", end: "23:00", endDate: null, category: "shift", title: "Вечер", employeeId: 5 }),
  entry({ templateId: 4, date: dayIso(1), start: "15:00", end: "23:00", endDate: null, category: "shift", title: "Ночь", employeeId: 1 }),

  // Ср
  entry({ templateId: 2, date: dayIso(2), start: "09:00", end: "18:00", endDate: null, category: "shift", title: "День", employeeId: 1 }),
  entry({ date: dayIso(2), start: "10:00", end: "19:00", endDate: null, category: "offsite", title: null, employeeId: 4 }),
  entry({ templateId: 5, date: dayIso(2), start: "09:00", end: "18:00", endDate: null, category: "duty", title: "Дежурство · Поклонка", location: "Поклонка", employeeId: 5 }),
  entry({ templateId: 2, date: dayIso(2), start: "09:00", end: "18:00", endDate: null, category: "shift", title: "День", employeeId: null }),
  // A cell a roster import could not read — exercises the grey «?» square. Real
  // imports produce these whenever the file says something like «Ко».
  entry({ date: dayIso(2), start: null, end: null, endDate: null, category: "shift", title: null, employeeId: 3, unrecognisedCode: "Ко" }),

  // Чт–Пт: Аня в отпуске (один интервал, показывается в оба дня)
  entry({ date: dayIso(3), start: null, end: null, endDate: dayIso(4), category: "vacation", title: null, employeeId: 1 }),
  // Чт: дежурство не по пресету — своё место, поэтому цвет категории
  entry({ date: dayIso(3), start: "09:00", end: "21:00", endDate: null, category: "duty", title: "Дежурство · Вавилова", employeeId: 3 }),
  entry({ templateId: 1, date: dayIso(3), start: "08:00", end: "17:00", endDate: null, category: "shift", title: "Утро", employeeId: 5 }),
  entry({ templateId: 7, date: dayIso(3), start: "09:00", end: "18:00", endDate: null, category: "duty", title: "Дежурство · Телефон", employeeId: 4 }),

  // Пт
  entry({ templateId: 2, date: dayIso(4), start: "09:00", end: "18:00", endDate: null, category: "shift", title: "День", employeeId: 2 }),
  entry({ templateId: 1, date: dayIso(4), start: "08:00", end: "17:00", endDate: null, category: "shift", title: "Утро", employeeId: 4 }),
  entry({ templateId: 8, date: dayIso(4), start: "09:00", end: "18:00", endDate: null, category: "duty", title: "Дежурство · Вавилова 19", location: "Вавилова 19", employeeId: 3 }),

  // Сб
  entry({ templateId: 3, date: dayIso(5), start: "11:00", end: "20:00", endDate: null, category: "shift", title: "Вечер", employeeId: 1 }),

  // Вс: Олег работает в выходной
  entry({ date: dayIso(6), start: "10:00", end: "18:00", endDate: null, category: "weekend_work", title: null, employeeId: 5 }),
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function endOf(s: Shift): string {
  return s.endDate ?? s.date;
}

function overlapsRange(s: Shift, from: string, to: string): boolean {
  return s.date <= to && endOf(s) >= from;
}

export async function mockGetMe(): Promise<Me> {
  await delay(150);
  return MOCK_ME;
}

/**
 * Мок домена read живёт в `@planer/client`, а состояние остаётся здесь.
 *
 * Так потому, что в `ALL_ENTRIES` и `EMPLOYEES` пишут ещё не переехавшие
 * домены — создание и правка записи, распределение, импорт ростера, — и экран
 * администратора рассчитывает, что правка сразу видна в графике. Массивы
 * передаются по ссылке, поэтому мутации остаются видимыми моку.
 *
 * Задержка ненулевая намеренно: в `npm run dev` она делает экраны честными.
 */
/**
 * Мок домена employees — над тем же массивом `EMPLOYEES`.
 *
 * Массив передаётся по ссылке, поэтому правки из «Работников» сразу видны и
 * моку `read` (график, «Команда»), и ещё не переехавшим доменам — отчётам,
 * выходным, сборам, дням рождения. Тот же довод, что и у `read`: пакет владеет
 * формой ответа, фронт — состоянием.
 *
 * `inviteLinkFor` приходит отсюда, потому что имя бота живёт в переменных
 * сборки мини-аппа, а не в пакете.
 */
const employeesMock = createEmployeesMock({ delayMs: 200, state: { employees: EMPLOYEES }, inviteLinkFor });
export { employeesMock };

const readMock = createReadMock({
  delayMs: 250,
  state: {
    get templates() {
      return TEMPLATES;
    },
    get entries() {
      return ALL_ENTRIES;
    },
    get employees() {
      return EMPLOYEES;
    },
    get meId() {
      return MOCK_ME.id;
    },
  },
});

export function mockGetMyShifts(): Promise<{ shifts: Shift[]; today: string }> {
  return readMock.getMyShifts();
}

export function mockGetTeamSchedule(from: string, to: string): Promise<TeamScheduleResponse> {
  return readMock.getTeamSchedule(from, to);
}

/**
 * In-memory "Обмены" store for local development. The real `GET /api/swaps`
 * returns bare rows with no shift times or counterparty names (see the
 * `SwapRequest` doc comment in `client.ts`) — enriching it server-side is
 * tracked as a follow-up, not done here. This mock instead keeps the fully
 * ENRICHED shape the UI actually renders, and every mutator below
 * (`mockProposeSwap`/`mockAcceptSwap`/`mockDeclineSwap`/`mockCancelSwap`)
 * updates it in place so the "Обмены" tab reflects changes live, without a
 * page reload.
 */

function findShiftById(id: number): Shift {
  const shift = ALL_ENTRIES.find((s) => s.id === id);
  if (!shift) throw new Error(`Unknown shift id ${id}`);
  return shift;
}

/** The one `category === "shift"` entry for this employee on this day — used only to seed realistic swap requests below. */
function shiftOf(employeeId: number, date: string): Shift {
  const shift = ALL_ENTRIES.find((s) => s.employeeId === employeeId && s.date === date && s.category === "shift");
  if (!shift) throw new Error(`No seed shift for employee ${employeeId} on ${date}`);
  return shift;
}

function toSummary(shift: Shift): SwapShiftSummary {
  return { date: shift.date, start: shift.start, end: shift.end, title: shift.title, category: shift.category };
}

let nextSwapId = 1;

/** Builds the enriched request as seen from `MOCK_ME`'s point of view (the mock only ever runs as Аня). */
function buildSwapRequest(input: {
  direction: SwapDirection;
  status: SwapStatus;
  message: string | null;
  createdAt: Date;
  counterpartyId: number;
  yourShift: Shift;
  theirShift: Shift;
}): SwapRequest {
  return {
    id: nextSwapId++,
    direction: input.direction,
    status: input.status,
    message: input.message,
    createdAt: input.createdAt.toISOString(),
    counterpartyName: personName(input.counterpartyId),
    yourShift: toSummary(input.yourShift),
    theirShift: toSummary(input.theirShift),
  };
}

// Seed: 1 incoming request (Игорь proposes to Аня) + 1 outgoing request
// (Аня proposed to Марк), both pending, so the "Обмены" tab has something to
// show from the first load.
const SWAPS: SwapRequest[] = [
  buildSwapRequest({
    direction: "incoming",
    status: "pending",
    message: "Смогу выйти в пятницу вместо тебя — подстрахуешь меня в субботу?",
    createdAt: new Date(Date.now() - 20 * 60 * 60 * 1000),
    counterpartyId: 2, // Игорь Петров
    yourShift: shiftOf(1, dayIso(5)), // Аня, Сб
    theirShift: shiftOf(2, dayIso(4)), // Игорь, Пт
  }),
  buildSwapRequest({
    direction: "outgoing",
    status: "pending",
    message: null,
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    counterpartyId: 3, // Марк Волков
    yourShift: shiftOf(1, dayIso(2)), // Аня, Ср
    theirShift: shiftOf(3, dayIso(1)), // Марк, Вт
  }),
];

export async function mockGetSwaps(): Promise<SwapRequest[]> {
  await delay(200);
  return [...SWAPS].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function mockProposeSwap(fromShiftId: number, toShiftId: number, message?: string): Promise<SwapRequest> {
  await delay(300);
  const fromShift = findShiftById(fromShiftId);
  const toShift = findShiftById(toShiftId);
  const request = buildSwapRequest({
    direction: "outgoing",
    status: "pending",
    message: message?.trim() ? message.trim() : null,
    createdAt: new Date(),
    counterpartyId: toShift.employeeId ?? MOCK_ME.id,
    yourShift: fromShift,
    theirShift: toShift,
  });
  SWAPS.unshift(request);
  return request;
}

function resolveSwap(id: number, status: SwapStatus): void {
  const index = SWAPS.findIndex((s) => s.id === id);
  if (index === -1) return;
  SWAPS[index] = { ...SWAPS[index]!, status };
}

export async function mockAcceptSwap(id: number): Promise<void> {
  await delay(250);
  resolveSwap(id, "accepted");
}

export async function mockDeclineSwap(id: number): Promise<void> {
  await delay(250);
  resolveSwap(id, "declined");
}

export async function mockCancelSwap(id: number): Promise<void> {
  await delay(250);
  resolveSwap(id, "cancelled");
}

/**
 * In-memory "Работа в выходные дни" (weekend marketplace) store for local development —
 * open vacant slots the caller (Аня) can raise a hand for, plus offers an
 * admin already addressed to her. Every mutator updates it in place so the
 * tab reflects taps live, mirroring the swaps mock above.
 */

interface SlotSeed {
  slot: VacantSlot;
  interestedIds: Set<number>;
  /** Who is already going — workers see this too, not just admins. */
  assignees: { employeeId: number; name: string; status: string }[];
}

const WEEKEND_SLOTS: SlotSeed[] = [
  {
    slot: { id: 101, date: dayIso(5), start: "10:00", end: "18:00", title: "Ярмарка выходного дня", location: "ТЦ Авиапарк", note: "Нужен один человек на стенд", status: "open" },
    interestedIds: new Set([3]),
    assignees: [{ employeeId: 5, name: personName(5), status: "confirmed" }],
  },
  {
    slot: { id: 102, date: dayIso(6), start: "11:00", end: "19:00", title: null, location: "Склад на Вавилова", note: null, status: "open" },
    interestedIds: new Set([1, 5]), // Аня уже записалась
    assignees: [],
  },
  {
    slot: { id: 103, date: dayIso(12), start: "09:00", end: "15:00", title: "Инвентаризация", location: null, note: "Полдня, оплата в двойном размере", status: "open" },
    interestedIds: new Set(),
    assignees: [],
  },
];

const OFFERS: WeekendOffer[] = [
  {
    assignment: { id: 501, status: "offered", hours: 8 },
    slot: { id: 104, date: dayIso(13), start: "10:00", end: "18:00", title: "Праздничная смена", location: "Главный офис", note: null, status: "assigned" },
  },
];

export async function mockGetWeekendSlots(): Promise<WeekendSlotView[]> {
  await delay(250);
  return WEEKEND_SLOTS.filter((s) => s.slot.status === "open").map((s) => ({
    slot: s.slot,
    interested: s.interestedIds.has(MOCK_ME.id),
    assignees: [...s.assignees],
  }));
}

export async function mockExpressInterest(slotId: number): Promise<void> {
  await delay(250);
  WEEKEND_SLOTS.find((s) => s.slot.id === slotId)?.interestedIds.add(MOCK_ME.id);
}

export async function mockGetWeekendOffers(): Promise<WeekendOffer[]> {
  await delay(200);
  return OFFERS.filter((o) => o.assignment.status !== "declined");
}

function setOfferStatus(id: number, status: WeekendOffer["assignment"]["status"]): void {
  const offer = OFFERS.find((o) => o.assignment.id === id);
  if (offer) offer.assignment = { ...offer.assignment, status };
}

export async function mockConfirmOffer(id: number): Promise<void> {
  await delay(250);
  setOfferStatus(id, "confirmed");
}

export async function mockDeclineOffer(id: number): Promise<void> {
  await delay(250);
  setOfferStatus(id, "declined");
}

/* ===========================================================================
 * Admin ("Админ" tab) mocks
 *
 * Mirrors `admin/src/api/mock.ts`, but reuses this module's existing roster
 * (`EMPLOYEES`) and schedule (`ALL_ENTRIES`) so the admin schedule edits show
 * up in the worker "Смены"/"Команда" views too — it's one shared dataset.
 * =========================================================================== */

// --- Работники --------------------------------------------------------------

// --- Расписание -------------------------------------------------------------

const TEMPLATES: readonly Template[] = [
  { id: 1, sortOrder: 1, name: "Утро", accent: "gold", start: "08:00", end: "17:00", fridayStart: "08:00", fridayEnd: "15:45", isLate: false, sendReminder: true, category: "shift", location: null },
  { id: 2, sortOrder: 2, name: "День", accent: "blue", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: false, category: "shift", location: null },
  { id: 3, sortOrder: 3, name: "Вечер", accent: "violet", start: "11:00", end: "20:00", fridayStart: "12:00", fridayEnd: "20:00", isLate: true, sendReminder: false, category: "shift", location: null },
  { id: 4, sortOrder: 4, name: "Ночь", accent: "indigo", start: "15:00", end: "23:00", fridayStart: "16:00", fridayEnd: "23:00", isLate: true, sendReminder: true, category: "shift", location: null },
  { id: 5, sortOrder: 5, name: "Дежурство · Поклонка", accent: "teal", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: true, category: "duty", location: "Поклонка" },
  { id: 6, sortOrder: 0, name: "Дежурство с 07:00", accent: "amber", start: "07:00", end: "16:00", fridayStart: "07:00", fridayEnd: "14:45", isLate: false, sendReminder: true, category: "duty", location: null },
  { id: 7, sortOrder: 6, name: "Дежурство · Телефон", accent: "rose", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: true, category: "duty", location: null },
  { id: 8, sortOrder: 7, name: "Дежурство · Вавилова 19", accent: "green", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: true, category: "duty", location: "Вавилова 19" },
];

export function mockGetTemplates(): Promise<Template[]> {
  return readMock.getTemplates() as Promise<Template[]>;
}

/** Реального `notifyEntryChange` в DEV-моке нет, поэтому «дошло до N из M» —
 *  по числу людей из `employeeIds`, у кого в моке есть телеграм. */
function mockReach(employeeIds: readonly number[]): { delivered: number; intended: number } {
  const unique = [...new Set(employeeIds)];
  const withTelegram = unique.filter((id) => EMPLOYEES.find((e) => e.id === id)?.telegramUserId != null);
  return { delivered: withTelegram.length, intended: unique.length };
}

export async function mockCreateEntry(input: NewEntryInput): Promise<{ entry: Shift; notified: { delivered: number; intended: number } }> {
  await delay(250);
  const created: Shift = {
    id: nextId++,
    date: input.date,
    start: input.start ?? null,
    end: input.end ?? null,
    endDate: input.endDate ?? null,
    category: input.category,
    title: input.title ?? null,
    location: input.location ?? null,
    templateId: input.templateId ?? null,
    employeeId: input.employeeId ?? null,
    unrecognisedCode: null,
    employeeName: input.employeeId != null ? personName(input.employeeId) : undefined,
  };
  ALL_ENTRIES.push(created);
  return { entry: created, notified: mockReach(input.employeeId != null ? [input.employeeId] : []) };
}

/**
 * Демо-расстановка диапазоном.
 *
 * Дни считает та же `planEntryRange`, что и сервер, а не своё похожее правило:
 * мок со своим счётом — второй источник правды, расходящийся с продом молча и
 * именно там, где демо показывают человеку.
 */
export async function mockCreateEntryRange(input: NewEntryRangeInput): Promise<EntryRangeResult> {
  await delay(300);
  const busyDates = ALL_ENTRIES.filter((s) => s.employeeId === input.employeeId).flatMap((s) =>
    eachDayIso(s.date, s.endDate ?? s.date),
  );
  const plan = planEntryRange({
    from: input.from,
    to: input.to,
    category: input.category,
    includeWeekends: input.includeWeekends ?? false,
    busyDates,
  });
  const spans = isAbsence(input.category) && input.to !== input.from;
  const created: Shift[] = plan.days.map((date) => ({
    id: nextId++,
    date,
    start: input.start ?? null,
    end: input.end ?? null,
    endDate: spans ? input.to : null,
    category: input.category,
    title: input.title ?? null,
    location: input.location ?? null,
    templateId: input.templateId ?? null,
    employeeId: input.employeeId,
    unrecognisedCode: null,
    employeeName: personName(input.employeeId),
  }));
  ALL_ENTRIES.push(...created);
  return { created, skipped: plan.skipped, notified: mockReach(created.length > 0 ? [input.employeeId] : []) };
}

/** Один запрос вместо цикла — DEV-мок отвечает так же, чтобы «Заполнить неделю»
 *  вело себя в разработке так же, как на живом сервере: одно письмо на человека,
 *  не письмо на каждый созданный день. */
export async function mockCreateEntries(inputs: NewEntryInput[]): Promise<{ created: number; notified: { delivered: number; intended: number } }> {
  await delay(300);
  const employeeIds: number[] = [];
  for (const input of inputs) {
    const created: Shift = {
      id: nextId++,
      date: input.date,
      start: input.start ?? null,
      end: input.end ?? null,
      endDate: input.endDate ?? null,
      category: input.category,
      title: input.title ?? null,
      location: input.location ?? null,
      templateId: input.templateId ?? null,
      employeeId: input.employeeId ?? null,
      unrecognisedCode: null,
      employeeName: input.employeeId != null ? personName(input.employeeId) : undefined,
    };
    ALL_ENTRIES.push(created);
    if (input.employeeId != null) employeeIds.push(input.employeeId);
  }
  return { created: inputs.length, notified: mockReach(employeeIds) };
}

export async function mockUpdateEntry(id: number, input: NewEntryInput): Promise<{ entry: Shift; notified: { delivered: number; intended: number } }> {
  await delay(250);
  const shift = ALL_ENTRIES.find((s) => s.id === id);
  if (!shift) throw new Error(`Unknown entry id ${id}`);
  shift.date = input.date;
  shift.category = input.category;
  shift.start = input.start ?? null;
  shift.end = input.end ?? null;
  shift.endDate = input.endDate ?? null;
  shift.title = input.title ?? null;
  shift.location = input.location ?? null;
  if (input.employeeId != null) {
    shift.employeeId = input.employeeId;
    shift.employeeName = personName(input.employeeId);
  }
  return { entry: shift, notified: mockReach(shift.employeeId != null ? [shift.employeeId] : []) };
}

export async function mockDeleteEntry(id: number): Promise<{ notified: { delivered: number; intended: number } }> {
  await delay(150);
  const index = ALL_ENTRIES.findIndex((s) => s.id === id);
  if (index === -1) return { notified: { delivered: 0, intended: 0 } };
  const [removed] = ALL_ENTRIES.splice(index, 1);
  return { notified: mockReach(removed?.employeeId != null ? [removed.employeeId] : []) };
}

/**
 * Самозапись работника в DEV-моке.
 *
 * Отказы считает та же `selfEntryRefusal` из `@planer/shared`, что и сервер, а
 * не список условий, набранный здесь заново: мок, который разрешает больше
 * настоящей ручки, врёт ровно про то, ради чего его открывают — про поведение
 * формы на отказе.
 *
 * Письма админам тут нет и быть не может: телеграма в DEV нет вовсе.
 */
/**
 * Смены, которые больничный оставляет без человека, — как их считает сервер.
 *
 * Кандидаты — активные, у кого в этот день ничего не стоит: то же правило, что
 * в `handoverCandidates`. Мок, показывающий занятого коллегу, врал бы ровно про
 * то, ради чего второй шаг формы и существует.
 */
function mockHandoverDrafts(input: SelfEntryInput, sickId: number): HandoverDraft[] {
  if (input.category !== "sick_leave") return [];
  const from = input.date;
  const to = input.endDate ?? input.date;
  return ALL_ENTRIES.filter(
    (entry) =>
      entry.employeeId === MOCK_ME.id &&
      entry.id !== sickId &&
      entry.category === "shift" &&
      entry.date >= from &&
      entry.date <= to,
  ).map((shift) => ({
    id: nextId++,
    shiftLine: `${shift.date} · ${shift.start ?? "весь день"}${shift.end ? `–${shift.end}` : ""} · ${shift.title ?? "Смена"}`,
    candidates: EMPLOYEES.filter(
      (employee) =>
        employee.isActive &&
        employee.id !== MOCK_ME.id &&
        !employee.excludedFromSwaps &&
        !ALL_ENTRIES.some((entry) => entry.employeeId === employee.id && entry.date === shift.date),
    ).map((employee) => ({ id: employee.id, displayName: employee.displayName })),
  }));
}

export async function mockCreateSelfEntry(input: SelfEntryInput): Promise<{ entry: Shift; handovers: HandoverDraft[] }> {
  await delay(250);
  const today = toISODate(new Date());
  const refusal = selfEntryRefusal(
    { category: input.category, date: input.date, endDate: input.category === "sick_leave" ? input.endDate : null },
    today,
  );
  if (refusal) throw new Error(refusal);
  const created: Shift = {
    id: nextId++,
    date: input.date,
    start: input.category === "offsite" ? input.start : null,
    end: input.category === "offsite" ? input.end : null,
    endDate: input.category === "sick_leave" ? (input.endDate ?? null) : null,
    category: input.category,
    title: input.category === "offsite" ? input.title : null,
    location: input.category === "offsite" ? (input.location ?? null) : null,
    templateId: null,
    employeeId: MOCK_ME.id,
    unrecognisedCode: null,
    employeeName: personName(MOCK_ME.id),
  };
  ALL_ENTRIES.push(created);
  return { entry: created, handovers: mockHandoverDrafts(input, created.id) };
}

/** DEV-мок писем не шлёт — телеграма здесь нет вовсе; форма проверяется по факту вызова. */
export async function mockOfferHandover(_handoverId: number, _toEmployeeId: number): Promise<void> {
  await delay(200);
}

export async function mockSkipHandover(_handoverId: number): Promise<void> {
  await delay(200);
}

export async function mockUpdateSelfEntry(id: number, input: SelfEntryInput): Promise<Shift> {
  await delay(250);
  const today = toISODate(new Date());
  const shift = ALL_ENTRIES.find((s) => s.id === id && s.employeeId === MOCK_ME.id);
  // Чужая и несуществующая — один ответ, как на сервере: подтверждать, что
  // чужая запись существует, здесь тоже нечем.
  if (!shift) throw new Error("not_found");
  const editRefusal = selfEntryEditRefusal(shift, today);
  if (editRefusal) throw new Error(editRefusal);
  const moveRefusal = selfEntryRefusal(
    { category: input.category, date: input.date, endDate: input.category === "sick_leave" ? input.endDate : null },
    today,
  );
  if (moveRefusal) throw new Error(moveRefusal);
  if (shift.category !== input.category) throw new Error("Вид записи менять нельзя");

  shift.date = input.date;
  shift.endDate = input.category === "sick_leave" ? (input.endDate ?? null) : null;
  shift.start = input.category === "offsite" ? input.start : null;
  shift.end = input.category === "offsite" ? input.end : null;
  shift.title = input.category === "offsite" ? input.title : null;
  shift.location = input.category === "offsite" ? (input.location ?? null) : null;
  return shift;
}

export async function mockDeleteSelfEntry(id: number): Promise<void> {
  await delay(150);
  const index = ALL_ENTRIES.findIndex((s) => s.id === id && s.employeeId === MOCK_ME.id);
  if (index === -1) throw new Error("not_found");
  const refusal = selfEntryEditRefusal(ALL_ENTRIES[index]!, toISODate(new Date()));
  if (refusal) throw new Error(refusal);
  ALL_ENTRIES.splice(index, 1);
}

/**
 * A deliberately simple stand-in for the server's fair-distribution pass:
 * hands every still-unassigned entry in the window to whichever active worker
 * is currently carrying the fewest entries that week (ties broken by id).
 * `apply` writes the choices back onto `ALL_ENTRIES`; otherwise it's a preview.
 */
export async function mockDistribute(from: string, to: string, apply: boolean): Promise<DistributeResult> {
  await delay(300);
  const activeIds = EMPLOYEES.filter((e) => e.isActive).map((e) => e.id);
  const load = new Map<number, number>(activeIds.map((id) => [id, 0]));
  for (const s of ALL_ENTRIES) {
    if (s.employeeId != null && load.has(s.employeeId) && overlapsRange(s, from, to)) {
      load.set(s.employeeId, (load.get(s.employeeId) ?? 0) + 1);
    }
  }
  const assignments: { shiftId: number; employeeId: number }[] = [];
  // Same contract as the server's: a slot it could not place comes back said out
  // loud, so the dev screen shows the real notice rather than a silent shortfall.
  const unfilled: UnfilledSlot[] = [];
  for (const shift of ALL_ENTRIES.filter((s) => s.employeeId == null && overlapsRange(s, from, to))) {
    let best = activeIds[0];
    if (best == null) {
      unfilled.push({ shiftId: shift.id, date: shift.date, kind: shift.title ?? "Своё время", reason: "nobody_free" });
      continue;
    }
    for (const id of activeIds) {
      if ((load.get(id) ?? 0) < (load.get(best) ?? 0)) best = id;
    }
    assignments.push({ shiftId: shift.id, employeeId: best });
    load.set(best, (load.get(best) ?? 0) + 1);
    if (apply) {
      shift.employeeId = best;
      shift.employeeName = personName(best);
    }
  }
  // Превью ничего не пишет, поэтому и не уведомляет — тот же контракт, что у сервера.
  const notified = apply ? mockReach(assignments.map((a) => a.employeeId)) : { delivered: 0, intended: 0 };
  return { applied: apply, assignments, unfilled, notified };
}

// --- Работа в выходные дни (admin) + учёт часов ------------------------------

let nextAdminSlotId = 300;
const ADMIN_SLOTS: AdminSlotView[] = [
  {
    slot: { id: 301, date: dayIso(5), start: "10:00", end: "18:00", title: "Ярмарка выходного дня", location: "ТЦ Авиапарк", note: "Нужен один человек на стенд", status: "open" },
    interested: [
      { employeeId: 3, name: personName(3), confirmedThisMonth: 0, passedOver: 2, absence: null },
      { employeeId: 2, name: personName(2), confirmedThisMonth: 1, passedOver: 0, absence: null },
      { employeeId: 5, name: personName(5), confirmedThisMonth: 2, passedOver: 0, absence: "vacation" },
    ],
    assignees: [],
  },
  {
    slot: { id: 302, date: dayIso(6), start: "11:00", end: "19:00", title: null, location: "Склад на Вавилова", note: null, status: "open" },
    interested: [
      { employeeId: 4, name: personName(4), confirmedThisMonth: 0, passedOver: 2, absence: null },
      { employeeId: 5, name: personName(5), confirmedThisMonth: 2, passedOver: 0, absence: null },
    ],
    assignees: [],
  },
  {
    slot: { id: 303, date: dayIso(12), start: "09:00", end: "15:00", title: "Инвентаризация", location: null, note: "Полдня, оплата в двойном размере", status: "open" },
    interested: [],
    assignees: [],
  },
];

/** Confirmed weekend work already logged — the payroll ledger backing the CSV export. */
const PAYROLL: PayrollRow[] = [
  { employeeId: 5, employeeName: personName(5), date: dayIso(-9), hours: 8 },
  { employeeId: 4, employeeName: personName(4), date: dayIso(-2), hours: 6 },
  { employeeId: 5, employeeName: personName(5), date: dayIso(-1), hours: 8 },
];

export async function mockGetAdminWeekendSlots(): Promise<AdminSlotView[]> {
  await delay(250);
  return ADMIN_SLOTS.filter((s) => s.slot.status === "open").map((s) => ({
    slot: s.slot,
    interested: [...s.interested].sort(
      (a, b) => a.confirmedThisMonth - b.confirmedThisMonth || b.passedOver - a.passedOver,
    ),
    assignees: [...s.assignees],
  }));
}

export async function mockPostSlot(input: NewSlotInput): Promise<VacantSlot & { delivered: number; intended: number }> {
  await delay(250);
  const slot: VacantSlot = {
    id: nextAdminSlotId++,
    date: input.date,
    start: input.start,
    end: input.end,
    title: input.title?.trim() ? input.title.trim() : null,
    location: input.location?.trim() ? input.location.trim() : null,
    note: input.note?.trim() ? input.note.trim() : null,
    status: "open",
  };
  ADMIN_SLOTS.unshift({ slot, interested: [], assignees: [] });
  // Not everybody in the demo roster linked Telegram — so the notice has
  // something to say about how far the call for volunteers got.
  const team = EMPLOYEES.filter((e) => e.isActive);
  return { ...slot, delivered: team.filter((e) => e.telegramUserId != null).length, intended: team.length };
}

let nextAssignmentId = 900;

export async function mockAssignSlot(slotId: number, employeeId: number): Promise<void> {
  await delay(250);
  const view = ADMIN_SLOTS.find((s) => s.slot.id === slotId);
  if (!view || view.assignees.some((a) => a.employeeId === employeeId)) return;
  // The slot stays open — it may need more than one person.
  view.assignees.push({ assignmentId: nextAssignmentId++, employeeId, name: personName(employeeId), status: "offered" });
  // Mirror the real flow's eventual outcome so the payroll ledger updates too.
  const hours = slotDurationHours(view.slot.start, view.slot.end);
  PAYROLL.push({ employeeId, employeeName: personName(employeeId), date: view.slot.date, hours });
}

export async function mockUnassignSlot(assignmentId: number): Promise<void> {
  await delay(200);
  for (const view of ADMIN_SLOTS) {
    const i = view.assignees.findIndex((a) => a.assignmentId === assignmentId);
    if (i !== -1) {
      view.assignees.splice(i, 1);
      return;
    }
  }
}

function slotDurationHours(start: string, end: string): number {
  const toMin = (hhmm: string) => Number(hhmm.split(":")[0]) * 60 + Number(hhmm.split(":")[1]);
  const startMin = toMin(start);
  let endMin = toMin(end);
  if (endMin <= startMin) endMin += 24 * 60;
  return (endMin - startMin) / 60;
}

export async function mockGetPayroll(from: string, to: string): Promise<PayrollRow[]> {
  await delay(200);
  return PAYROLL.filter((r) => r.date >= from && r.date <= to).sort(
    (a, b) => a.employeeName.localeCompare(b.employeeName) || a.date.localeCompare(b.date),
  );
}

function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export async function mockGetPayrollCsv(from: string, to: string): Promise<string> {
  const rows = await mockGetPayroll(from, to);
  const lines = rows.map((r) => [csvField(r.employeeName), r.date, String(r.hours)].join(","));
  return ["Работник,Дата,Часы", ...lines].join("\n");
}

// --- Roster CSV (the ФИО × даты matrix) --------------------------------------
// DEV mirror of server/src/roster/*: enough behaviour that the upload screen can be
// exercised end to end with no backend — including the two cases that used to be
// dead ends, an unreadable code and a period that is already full.

/** DEV store for who may take each preset and who asked for it. Empty = everyone. */
const TEMPLATE_ROLES = new Map<number, { pool: number[]; preference: Record<number, number> }>();

export async function mockGetTemplateRoles(): Promise<TemplateRolesView[]> {
  await delay(180);
  return TEMPLATES.map((template) => ({
    templateId: template.id,
    name: template.name,
    category: template.category,
    accent: template.accent,
    pool: [...(TEMPLATE_ROLES.get(template.id)?.pool ?? [])],
    preference: { ...(TEMPLATE_ROLES.get(template.id)?.preference ?? {}) },
    requiresChecklist: TEMPLATE_CHECKLIST.has(template.id),
  }));
}

/** Виды смен, которым в демо назначен чек-лист. */
const TEMPLATE_CHECKLIST = new Set<number>();

export async function mockSetTemplateChecklist(templateId: number, requiresChecklist: boolean): Promise<void> {
  await delay(150);
  if (requiresChecklist) TEMPLATE_CHECKLIST.add(templateId);
  else TEMPLATE_CHECKLIST.delete(templateId);
}

export async function mockSaveTemplateRoles(
  templateId: number,
  pool: number[],
  preference: Record<number, number>,
): Promise<void> {
  await delay(200);
  const active = new Set(EMPLOYEES.filter((e) => e.isActive).map((e) => e.id));
  const bad = [...new Set([...pool, ...Object.keys(preference).map(Number)])].filter((id) => !active.has(id));
  if (bad.length > 0) throw new Error(`неизвестные сотрудники: ${bad.join(", ")}`);
  TEMPLATE_ROLES.set(templateId, {
    pool: [...new Set(pool)],
    preference: Object.fromEntries(Object.entries(preference).filter(([, weight]) => weight > 0)),
  });
}

/** DEV rotation: same ordering rule as the server — newcomers first, then by how
 *  long ago somebody last held the preset. */
const ROTATION_UNITS = new Map<number, "day" | "week">();

export async function mockSetRotationUnit(templateId: number, rotationUnit: "day" | "week"): Promise<void> {
  await delay(150);
  ROTATION_UNITS.set(templateId, rotationUnit);
}

export async function mockGetTemplateQueue(templateId: number): Promise<TemplateQueue> {
  await delay(200);
  const unit = ROTATION_UNITS.get(templateId) ?? "day";
  const asOf = toISODate(new Date());
  const pool = new Set(TEMPLATE_ROLES.get(templateId)?.pool ?? []);
  const eligible = EMPLOYEES.filter((e) => e.isActive && (pool.size === 0 || pool.has(e.id)));

  const lastHeld = new Map<number, string>();
  for (const shift of ALL_ENTRIES) {
    if (shift.templateId !== templateId || shift.employeeId == null) continue;
    const seen = lastHeld.get(shift.employeeId);
    if (!seen || shift.date > seen) lastHeld.set(shift.employeeId, shift.date);
  }

  const queue = rotationQueue(
    eligible.map((employee) => ({
      employeeId: employee.id,
      displayName: employee.displayName,
      rosterOrder: EMPLOYEES.indexOf(employee),
      lastHeld: lastHeld.get(employee.id) ?? null,
    })),
    asOf,
  ).map((turn) => ({
    employeeId: turn.employeeId,
    displayName: turn.displayName,
    daysSince: turn.daysSince,
    label: describeTurn(turn, unit),
  }));

  return { templateId, rotationUnit: unit, asOf, queue };
}

// --- Отчёты и журнал ---------------------------------------------------------

const MOCK_JOURNAL_TYPES = ["entry_created", "entry_updated", "entry_deleted", "swap_accepted", "roster_import"];

// actorId rides along for filtering; it isn't part of the JournalEvent the API
// returns per row (the row only ever carries the resolved name).
const JOURNAL: (JournalEvent & { actorId: number | null })[] = Array.from({ length: 34 }, (_, index) => {
  const actor = EMPLOYEES[index % 3] ?? null;
  return {
    id: 1000 - index,
    type: MOCK_JOURNAL_TYPES[index % MOCK_JOURNAL_TYPES.length]!,
    createdAt: new Date(Date.now() - index * 3_600_000).toISOString(),
    actorName: actor?.displayName ?? null,
    actorId: actor?.id ?? null,
    payload: { entryId: 500 + index },
  };
});

export async function mockGetJournal(params: { types?: string[]; actor?: number; limit?: number; offset?: number }): Promise<JournalPage> {
  await delay(200);
  const types = params.types ?? [];
  const matching = JOURNAL.filter(
    (event) => (types.length === 0 || types.includes(event.type)) && (params.actor == null || event.actorId === params.actor),
  );
  const limit = params.limit ?? 30;
  const offset = params.offset ?? 0;
  const actorsById = new Map(JOURNAL.filter((e) => e.actorId != null).map((e) => [e.actorId!, e.actorName!]));
  const availableActors = [...actorsById.entries()]
    .map(([id, displayName]) => ({ id, displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ru"));
  return {
    total: matching.length,
    limit,
    offset,
    availableTypes: [...new Set(JOURNAL.map((e) => e.type))].sort(),
    availableActors,
    events: matching.slice(offset, offset + limit).map(({ actorId: _actorId, ...event }) => event),
  };
}

// --- Сборы (ДР и кастомные) --------------------------------------------------
// Мок считает предпросмотр, заголовок, статус и активность теми же функциями
// из @planer/shared, что и сервер (`outgoingCollectionMessage`, `collectionTitle`,
// `collectionStatus`, `isCollectionActive`, `compareCollections`) — иначе
// DEV-режим начнёт показывать не тот текст, который реально уйдёт в бою.

/** Сборы DEV-режима: живут в памяти вкладки, как и весь остальной мок. */
const COLLECTIONS: Collection[] = [];
let nextCollectionId = 1;

function blankCollection(patch: Partial<Collection>): Collection {
  return {
    id: nextCollectionId++, kind: "custom", employeeId: null, year: null, celebratedOn: null,
    title: null, eventDate: null, deadline: null, amountPerPerson: null, totalGoal: null,
    collectUrl: null, messageText: null, closedAt: null, scheduledSendOn: null,
    scheduleNotifiedAt: null, sentAt: null, sentCount: 0, sendCount: 0,
    createdAt: new Date().toISOString(), ...patch,
  };
}

function findCollection(id: number): Collection | undefined {
  return COLLECTIONS.find((c) => c.id === id);
}

/**
 * Как `readableCollection` на сервере: сбор, у которого виновник — сам смотрящий,
 * не читается вообще, ни по id, ни в списке. «Сюрприз»-правило: единственный
 * человек, который не должен видеть свой сбор — именно он, включая случай, когда
 * он же и админ. Отдаём «not_found», а не отказ отдельным кодом — 403 подтвердил
 * бы, что сбор существует, а прятать нужно именно этот факт.
 */
function readableCollection(id: number): Collection | undefined {
  const collection = findCollection(id);
  if (!collection || collection.employeeId === MOCK_ME.id) return undefined;
  return collection;
}

/** Имя виновника, или null — для общего сбора или удалённого работника. */
function personNameOf(employeeId: number | null): string | null {
  if (employeeId == null) return null;
  return EMPLOYEES.find((e) => e.id === employeeId)?.displayName ?? null;
}

function mockRecipients(employeeId: number | null): { employeeId: number; displayName: string }[] {
  return EMPLOYEES.filter((e) => e.isActive && e.id !== employeeId && e.telegramUserId != null)
    .map((e) => ({ employeeId: e.id, displayName: e.displayName }));
}

/** То, что реально уйдёт команде, и кому — теми же правилами, что у сервера. */
function previewOf(collection: Collection): CollectionPreview {
  const personName = personNameOf(collection.employeeId);
  const recipients = mockRecipients(collection.employeeId);
  const honouree = collection.employeeId != null ? EMPLOYEES.find((e) => e.id === collection.employeeId) : null;

  const message = outgoingCollectionMessage(
    {
      kind: collection.kind,
      title: collection.title,
      personName,
      birthDateLabel: honouree?.birthDate ?? null,
      eventDate: collection.eventDate,
      deadline: collection.deadline,
      amountPerPerson: collection.amountPerPerson,
      totalGoal: collection.totalGoal,
      collectUrl: collection.collectUrl,
    },
    collection.sendCount > 0 ? "reminder" : "first",
    collection.messageText,
  );

  let blocker: string | null = null;
  if (collection.closedAt) blocker = "Сбор закрыт — рассылать нечего.";
  else if (collection.kind === "birthday" && collection.sendCount > 0) {
    blocker = "Уже разослано — повторная отправка отключена.";
  } else if (!collection.collectUrl) blocker = "Нет ссылки на сбор — вставь её, прежде чем рассылать.";
  else if (recipients.length === 0) blocker = "Некому отправлять: ни у кого из команды не привязан Telegram.";

  return {
    id: collection.id,
    kind: collection.kind,
    title: collectionTitle(collection, personName),
    personName,
    employeeId: collection.employeeId,
    collectUrl: collection.collectUrl,
    message,
    recipients,
    blocker,
    sendCount: collection.sendCount,
    lastSentAt: collection.sentAt,
  };
}

function rowOf(collection: Collection, today: string): CollectionRow {
  const personName = personNameOf(collection.employeeId);
  return {
    collection,
    personName,
    title: collectionTitle(collection, personName),
    status: collectionStatus(collection),
    active: isCollectionActive(collection, today),
  };
}

/** Применяет правку: та же логика заморозки повода/виновника после первой
 *  рассылки и то же окно дат напоминания, что у сервера. */
function applyPatch(collection: Collection, patch: CollectionPatch, today: string): void {
  const subjectTouched =
    (patch.title !== undefined && patch.title !== collection.title) ||
    (patch.employeeId !== undefined && patch.employeeId !== collection.employeeId);
  if (collection.sendCount > 0 && subjectTouched) {
    throw new Error("Сбор уже разослан — повод и виновника менять нельзя.");
  }

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new Error("Повод не может быть пустым");
    collection.title = title;
  }
  if (patch.employeeId !== undefined) {
    if (patch.employeeId != null && !EMPLOYEES.some((e) => e.id === patch.employeeId)) {
      throw new Error("Такого работника нет");
    }
    collection.employeeId = patch.employeeId;
  }
  if (patch.collectUrl !== undefined) {
    const url = patch.collectUrl?.trim() || null;
    if (url && !/^https?:\/\/\S+$/i.test(url)) throw new Error("Ссылка должна начинаться с http:// или https://");
    collection.collectUrl = url;
  }
  if (patch.messageText !== undefined) collection.messageText = patch.messageText?.trim() || null;
  if (patch.eventDate !== undefined) collection.eventDate = patch.eventDate ?? null;
  if (patch.deadline !== undefined) collection.deadline = patch.deadline ?? null;
  if (patch.amountPerPerson !== undefined) collection.amountPerPerson = patch.amountPerPerson ?? null;
  if (patch.totalGoal !== undefined) collection.totalGoal = patch.totalGoal ?? null;
  if (patch.scheduledSendOn !== undefined) {
    const value = patch.scheduledSendOn ?? null;
    if (value !== null) {
      // Как на сервере: от сегодня и не позже края сбора — кроме повторной
      // отправки уже сохранённой даты, это не правка, а нажатие «сохранить».
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Дата должна быть в виде ГГГГ-ММ-ДД");
      if (value !== collection.scheduledSendOn && value < today) throw new Error("Дата напоминания уже прошла");
      const edge = collection.celebratedOn ?? collection.deadline ?? collection.eventDate;
      if (edge && value > edge) throw new Error("Напоминать после самого события уже поздно");
    }
    if (value !== collection.scheduledSendOn) collection.scheduleNotifiedAt = null;
    collection.scheduledSendOn = value;
  }
}

// --- Дни рождения -------------------------------------------------------------
// Раунд ДР живёт в той же таблице COLLECTIONS, что и кастомные сборы — сервер
// устроен так же (см. `server/src/birthdays/birthday-service.ts`).

function birthdayOccurrence(employee: Employee, today: string): { celebratedOn: string; year: number } | null {
  if (!employee.birthDate) return null;
  const days = daysUntilBirthday(employee.birthDate, today);
  if (days === null) return null;
  const celebratedOn = toISODate(addDays(new Date(`${today}T00:00:00Z`), days));
  return { celebratedOn, year: Number(celebratedOn.slice(0, 4)) };
}

function findBirthdayRound(employeeId: number, year: number): Collection | undefined {
  return COLLECTIONS.find((c) => c.kind === "birthday" && c.employeeId === employeeId && c.year === year);
}

/** GET не пишет: если раунда ещё нет, отдаёт черновик с `id: 0`, ничего не заводя.
 *  Строится напрямую, а не через `blankCollection` — иначе каждый непрочитанный
 *  предпросмотр съедал бы одно значение из общего счётчика `nextCollectionId`. */
function birthdayRoundDraft(employeeId: number, today: string): Collection | null {
  const employee = EMPLOYEES.find((e) => e.id === employeeId);
  if (!employee) return null;
  const occurrence = birthdayOccurrence(employee, today);
  if (!occurrence) return null;
  const existing = findBirthdayRound(employeeId, occurrence.year);
  if (existing) return existing;
  return {
    id: 0, kind: "birthday", employeeId, year: occurrence.year, celebratedOn: occurrence.celebratedOn,
    title: null, eventDate: null, deadline: null, amountPerPerson: null, totalGoal: null,
    collectUrl: null, messageText: null, closedAt: null, scheduledSendOn: null,
    scheduleNotifiedAt: null, sentAt: null, sentCount: 0, sendCount: 0,
    createdAt: new Date(0).toISOString(),
  };
}

/** Находит раунд этого года — или заводит его первым сохранением. */
function ensureBirthdayRound(employeeId: number, today: string): Collection | null {
  const employee = EMPLOYEES.find((e) => e.id === employeeId);
  if (!employee) return null;
  const occurrence = birthdayOccurrence(employee, today);
  if (!occurrence) return null;
  const existing = findBirthdayRound(employeeId, occurrence.year);
  if (existing) return existing;
  const created = blankCollection({ kind: "birthday", employeeId, year: occurrence.year, celebratedOn: occurrence.celebratedOn });
  COLLECTIONS.push(created);
  return created;
}

export async function mockGetBirthdays(): Promise<UpcomingBirthday[]> {
  await delay(200);
  const today = toISODate(new Date());
  // Сюрприз-правило: тикающий раз в неделю пуш видят все админы, кроме
  // именинника — даже когда именинник сам админ и смотрит список.
  return EMPLOYEES.filter((e) => e.isActive && e.birthDate && e.id !== MOCK_ME.id)
    .flatMap((employee) => {
      const occurrence = birthdayOccurrence(employee, today);
      const daysUntil = daysUntilBirthday(employee.birthDate!, today);
      if (!occurrence || daysUntil === null) return [];
      return [{
        employeeId: employee.id,
        displayName: employee.displayName,
        birthDate: employee.birthDate!,
        birthDateLabel: formatBirthDate(employee.birthDate!),
        celebratedOn: occurrence.celebratedOn,
        daysUntil,
        campaign: findBirthdayRound(employee.id, occurrence.year) ?? null,
      }];
    })
    .sort((a, b) => a.daysUntil - b.daysUntil || a.displayName.localeCompare(b.displayName, "ru"));
}

export async function mockGetBirthdayPreview(employeeId: number): Promise<CollectionPreview> {
  await delay(180);
  // Сюрприз-правило: «not_found», не отказ — 403 подтвердил бы, что для него
  // готовится раунд, а прятать нужно именно этот факт.
  if (employeeId === MOCK_ME.id) throw new Error("not_found");
  const today = toISODate(new Date());
  const draft = birthdayRoundDraft(employeeId, today);
  if (!draft) throw new Error("У этого работника не указан день рождения");
  return previewOf(draft);
}

export async function mockSaveBirthdayRound(employeeId: number, patch: CollectionPatch): Promise<Collection> {
  await delay(180);
  if (employeeId === MOCK_ME.id) throw new Error("not_found");
  // У раунда ДР нет повода на правку — он назван по имени именинника.
  if (patch.title !== undefined || patch.employeeId !== undefined) {
    throw new Error("У сбора на день рождения повод и виновник заданы датой рождения.");
  }
  const today = toISODate(new Date());
  const round = ensureBirthdayRound(employeeId, today);
  if (!round) throw new Error("У этого работника не указан день рождения");
  applyPatch(round, patch, today);
  return { ...round };
}

// --- Сборы: общий список и CRUD ----------------------------------------------

export async function mockGetCollections(): Promise<CollectionRow[]> {
  await delay(200);
  const today = toISODate(new Date());
  // Сюрприз-правило: как `listCollections` на сервере — свой собственный сбор
  // не виден вообще, даже в списке.
  return COLLECTIONS
    .filter((c) => c.employeeId !== MOCK_ME.id)
    .map((c) => rowOf(c, today))
    .sort((a, b) => compareCollections(a.collection, b.collection, today));
}

export async function mockCreateCollection(input: NewCollectionInput): Promise<Collection> {
  await delay(180);
  const title = input.title?.trim();
  if (!title) throw new Error("Повод обязателен");
  if (input.employeeId != null && !EMPLOYEES.some((e) => e.id === input.employeeId)) {
    throw new Error("Такого работника нет");
  }
  if (input.collectUrl) {
    const url = input.collectUrl.trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) throw new Error("Ссылка должна начинаться с http:// или https://");
  }
  const created = blankCollection({
    kind: "custom",
    title,
    employeeId: input.employeeId ?? null,
    eventDate: input.eventDate ?? null,
    deadline: input.deadline ?? null,
    amountPerPerson: input.amountPerPerson ?? null,
    totalGoal: input.totalGoal ?? null,
    collectUrl: input.collectUrl ?? null,
    messageText: input.messageText ?? null,
    scheduledSendOn: input.scheduledSendOn ?? null,
  });
  COLLECTIONS.push(created);
  return { ...created };
}

export async function mockGetCollectionPreview(id: number): Promise<CollectionPreview> {
  await delay(180);
  const collection = readableCollection(id);
  if (!collection) throw new Error("not_found");
  return previewOf(collection);
}

export async function mockSaveCollection(id: number, patch: CollectionPatch): Promise<Collection> {
  await delay(180);
  const collection = readableCollection(id);
  if (!collection) throw new Error("not_found");
  applyPatch(collection, patch, toISODate(new Date()));
  return { ...collection };
}

export async function mockSendCollection(id: number): Promise<{ delivered: number; intended: number; round: number }> {
  await delay(400);
  const collection = readableCollection(id);
  if (!collection) throw new Error("not_found");
  const preview = previewOf(collection);
  if (preview.blocker) throw new Error(preview.blocker);
  const delivered = preview.recipients.length;
  collection.sentAt = new Date().toISOString();
  collection.sentCount = delivered;
  collection.sendCount += 1;
  return { delivered, intended: preview.recipients.length, round: collection.sendCount };
}

export async function mockSetCollectionClosed(id: number, closed: boolean): Promise<Collection> {
  await delay(150);
  const collection = readableCollection(id);
  if (!collection) throw new Error("not_found");
  collection.closedAt = closed ? new Date().toISOString() : null;
  return { ...collection };
}

export async function mockDeleteCollection(id: number): Promise<void> {
  await delay(150);
  const collection = readableCollection(id);
  if (!collection) throw new Error("not_found");
  if (collection.kind === "birthday") throw new Error("Сбор на день рождения не удаляется.");
  if (collection.sendCount > 0) throw new Error("Сбор уже разослан — удалить нельзя.");
  COLLECTIONS.splice(COLLECTIONS.indexOf(collection), 1);
}

/** Что видит работник во вкладке «Команда»: чужие сборы, которые уже разосланы и ещё идут. */
export async function mockGetMyCollections(): Promise<WorkerCollection[]> {
  await delay(200);
  const today = toISODate(new Date());
  return COLLECTIONS
    .filter((c) => c.employeeId !== MOCK_ME.id && c.sendCount > 0 && isCollectionActive(c, today))
    .map((c) => {
      const personName = personNameOf(c.employeeId);
      return {
        id: c.id,
        title: collectionTitle(c, personName),
        personName,
        collectUrl: c.collectUrl,
        amountPerPerson: c.amountPerPerson,
        totalGoal: c.totalGoal,
        deadline: c.deadline,
        eventDate: c.eventDate,
      };
    });
}

export async function mockGetShiftCounts(from: string, to: string): Promise<ShiftCountsReport> {
  await delay(220);
  const inRange = ALL_ENTRIES.filter((s) => s.date >= from && s.date <= to && s.employeeId != null);
  const kinds: string[] = [];
  const rows = EMPLOYEES.filter((e) => e.isActive).map((employee) => {
    const byKind: Record<string, number> = {};
    let total = 0;
    for (const shift of inRange) {
      if (shift.employeeId !== employee.id) continue;
      if (shift.category === "vacation" || shift.category === "sick_leave" || shift.category === "business_trip") continue;
      const kind = (shift.templateId != null ? TEMPLATES.find((t) => t.id === shift.templateId)?.name : undefined)
        ?? shift.title ?? "Своё время";
      byKind[kind] = (byKind[kind] ?? 0) + 1;
      total += 1;
      if (!kinds.includes(kind)) kinds.push(kind);
    }
    return { employeeId: employee.id, displayName: employee.displayName, byKind, total };
  });
  const ordered = TEMPLATES.map((t) => t.name).filter((name) => kinds.includes(name));
  return { from, to, kinds: [...ordered, ...kinds.filter((k) => !ordered.includes(k))], rows };
}

const MOCK_ROSTER_CODES = new Set(["holiday", "k32", "k32-7", "k32-8", "k32-11", "k32-15", "dezh", "pokl", "v19", "rezerv", "otp", "event"]);
/** What the export writes for an entry the matrix can't express. Never "bad code". */
const MOCK_PRESERVE_CODE = "?";
const PRESET_NAME_TO_CODE: Record<string, string> = {
  "День": "k32", "Дежурство с 07:00": "k32-7", "Утро": "k32-8", "Вечер": "k32-11",
  "Ночь": "k32-15", "Дежурство · Телефон": "dezh", "Дежурство · Поклонка": "pokl",
  "Дежурство · Вавилова 19": "v19",
};

function mockRuDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

function mockIsoDate(value: string): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (!match) throw new Error(`Некорректная дата в CSV: ${value}`);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/** Only entries the codec can write back are the import's to replace. */
function mockRosterCode(shift: Shift): string {
  const byPreset = TEMPLATES.find((t) => t.id === shift.templateId);
  const code = byPreset ? PRESET_NAME_TO_CODE[byPreset.name] : undefined;
  if (code) return code;
  if (shift.category === "vacation") return "otp";
  if (shift.category === "business_trip") return "event";
  return MOCK_PRESERVE_CODE;
}

export async function mockGetRosterCsv(from: string, to: string): Promise<string> {
  await delay(200);
  const dates: string[] = [];
  for (let d = from; d <= to; d = toISODate(addDays(new Date(`${d}T00:00:00Z`), 1))) dates.push(d);
  const rows = EMPLOYEES.filter((e) => e.isActive).map((e) => {
    const codes = dates.map((date) => {
      const covering = ALL_ENTRIES.find((s) => s.employeeId === e.id && s.date <= date && endOf(s) >= date);
      return covering ? mockRosterCode(covering) : "holiday";
    });
    return [e.displayName, ...codes].join(";");
  });
  return [["", ...dates.map(mockRuDate)].join(";"), ...rows].join("\r\n");
}

function mockParseRoster(csv: string) {
  const lines = csv.replace(/^﻿/, "").split(/\r\n|\r|\n/).filter(Boolean);
  const dates = (lines[0]?.split(";") ?? []).slice(1).map(mockIsoDate);
  if (dates.length === 0) throw new Error("В CSV нет дат");
  const people = lines.slice(1).map((line, index) => {
    const cells = line.split(";");
    const name = cells[0]?.trim() ?? "";
    if (cells.length - 1 !== dates.length) {
      throw new Error(`строка ${index + 2}${name ? ` («${name}»)` : ""}: ${cells.length - 1} клеток, а в шапке ${dates.length} дат`);
    }
    return { name, codes: cells.slice(1) };
  });
  return { dates, people };
}

export async function mockPreviewRosterImport(csv: string): Promise<RosterImportPreview> {
  await delay(220);
  const { dates, people } = mockParseRoster(csv);
  const unknown = people.flatMap((person) =>
    person.codes.flatMap((code, index) =>
      code && code !== MOCK_PRESERVE_CODE && !MOCK_ROSTER_CODES.has(code)
        ? [{ name: person.name, date: dates[index] ?? dates[0]!, code }]
        : [],
    ),
  );
  if (unknown.length > 0) {
    const first = unknown[0]!;
    throw new Error(`Не понял коды в файле: ${first.name}, ${mockRuDate(first.date)} — «${first.code}».`);
  }
  const from = dates[0]!;
  const to = dates.at(-1)!;
  return {
    from,
    to,
    entryCount: people.reduce(
      (sum, p) => sum + p.codes.filter((c) => c && c !== "holiday" && c !== MOCK_PRESERVE_CODE).length,
      0,
    ),
    people: people.map((p) => ({
      csvName: p.name,
      suggestedEmployeeId: EMPLOYEES.find((e) => e.isActive && e.displayName === p.name)?.id ?? null,
    })),
    unknowns: [],
    unknownsMessage: null,
    preservedCount: people.reduce((sum, p) => sum + p.codes.filter((c) => c === MOCK_PRESERVE_CODE).length, 0),
    existingCount: ALL_ENTRIES.filter((s) => overlapsRange(s, from, to)).length,
  };
}

export async function mockApplyRosterImport(
  csv: string,
  resolutions: RosterPersonResolution[],
  overwrite = false,
): Promise<RosterImportSummary & { notified: { delivered: number; intended: number } }> {
  const preview = await mockPreviewRosterImport(csv);
  await delay(250);
  if (preview.existingCount > 0 && !overwrite) {
    throw new Error(
      `За ${preview.from}..${preview.to} в базе уже есть ${preview.existingCount} записей. ` +
        `Отметьте «перезаписать период», чтобы заменить их.`,
    );
  }

  let entriesDeleted = 0;
  if (overwrite) {
    for (let i = ALL_ENTRIES.length - 1; i >= 0; i--) {
      const shift = ALL_ENTRIES[i]!;
      if (overlapsRange(shift, preview.from, preview.to) && mockRosterCode(shift) !== MOCK_PRESERVE_CODE) {
        ALL_ENTRIES.splice(i, 1);
        entriesDeleted++;
      }
    }
  }

  for (const resolution of resolutions) {
    if (resolution.action === "rename") {
      const employee = EMPLOYEES.find((item) => item.id === resolution.employeeId);
      if (employee) {
        employee.displayName = resolution.csvName;
        // Same rule as `mockRenameEmployee`/`mockSetEmployeePreferredName`.
        employee.address = employee.preferredName ?? resolution.csvName;
      }
    } else {
      EMPLOYEES.push({
        id: Math.max(0, ...EMPLOYEES.map((e) => e.id)) + 1,
        displayName: resolution.csvName,
        isAdmin: false,
        isActive: true,
        telegramUserId: null,
        birthDate: null,
        preferredName: null,
        address: resolution.csvName,
        excludedFromAssignment: false,
        excludedFromSwaps: false,
        isObserver: false,
        selfScheduleEnabled: false,
      });
    }
  }
  return {
    employeesRenamed: resolutions.filter((r) => r.action === "rename").length,
    employeesCreated: resolutions.filter((r) => r.action === "create").length,
    entriesInserted: preview.entryCount,
    entriesDeleted,
    cellsPreserved: preview.preservedCount,
    swapsExpired: 0,
    unknowns: [],
    // Мок не пишет по-дневные записи из файла в ALL_ENTRIES, поэтому не знает,
    // кому реально досталось что-то новое — молчаливый {0,0} честнее выдумки.
    notified: { delivered: 0, intended: 0 },
  };
}

// --- Настройки: замок обменов ------------------------------------------------

/** Живёт между вызовами, чтобы DEV-тумблер вёл себя как настоящий: нажал —
 *  и следующий getSettings отдаёт новое состояние. */
let mockSwapsLocked = false;

export async function mockGetSettings(): Promise<AdminSettings> {
  await delay(150);
  return {
    swapsLocked: mockSwapsLocked,
    swapsLockUpdatedAt: mockSwapsLocked ? new Date().toISOString() : null,
    swapsLockUpdatedBy: mockSwapsLocked ? "Игорь Петров" : null,
  };
}

export async function mockSetSwapsLock(locked: boolean): Promise<SwapLockResult> {
  await delay(250);
  mockSwapsLocked = locked;
  return { locked, cancelled: locked ? 2 : 0, delivered: 5, intended: 6 };
}

// --- Настройки: что писать админу --------------------------------------------

/** Живёт между вызовами по той же причине, что и `mockSwapsLocked` выше: нажал
 *  тумблер — и следующий getNoticePrefs должен помнить об этом, без перезагрузки. */
const mockMutedKinds = new Set<string>();

export async function mockGetNoticePrefs(): Promise<NoticePrefs> {
  await delay(150);
  return {
    kinds: ADMIN_NOTICE_KINDS.map((kind) => ({
      kind,
      title: ADMIN_NOTICE_LABELS[kind].title,
      hint: ADMIN_NOTICE_LABELS[kind].hint,
      enabled: !mockMutedKinds.has(kind),
    })),
  };
}

export async function mockSetNoticePref(kind: string, enabled: boolean): Promise<{ kind: string; enabled: boolean }> {
  await delay(200);
  if (enabled) mockMutedKinds.delete(kind);
  else mockMutedKinds.add(kind);
  return { kind, enabled };
}

/**
 * Кому уйдёт «всем» — глазами отправителя, с id, а не именами. Тот же пул,
 * что и ветка «всем» в `mockSendAnnouncement`, зеркалит серверный
 * `announcementRoster`: непривязанный к телеграму виден и назван, а не
 * пропадает из списка.
 */
export async function mockGetAnnouncementRecipients(): Promise<AnnouncementRecipient[]> {
  await delay(150);
  return EMPLOYEES.filter((e) => e.isActive && e.id !== MOCK_ME.id).map((e) => ({
    id: e.id,
    displayName: e.displayName,
    reachable: e.telegramUserId != null,
  }));
}

/**
 * Считает адресатов по тому же `EMPLOYEES`, которым отвечает `getAdminEmployees`
 * — иначе экран в dev показал бы одних людей, а мок отчитывался бы про других.
 * Правила ровно те, что у сервера (`announcementRecipients`): архивный или без
 * телеграма, даже выбранный явно, попадает в пул и в `unreachable` поимённо, а
 * не пропадает молча; отправитель исключается всегда.
 */
export async function mockSendAnnouncement(text: string, audience: AnnouncementAudience): Promise<AnnouncementResult> {
  await delay(300);
  if (!text.trim()) throw new Error("Текст объявления пустой");

  const pool =
    audience === "all"
      ? EMPLOYEES.filter((e) => e.isActive && e.id !== MOCK_ME.id)
      : [...new Set(audience)]
          .map((id) => EMPLOYEES.find((e) => e.id === id))
          .filter((e): e is Employee => e != null && e.id !== MOCK_ME.id);

  const reachable = pool.filter((e) => e.isActive && e.telegramUserId != null);
  const unreachable = pool.filter((e) => !e.isActive || e.telegramUserId == null).map((e) => e.displayName);

  return { delivered: reachable.length, intended: reachable.length, unreachable };
}

// --- Багрепорты ---------------------------------------------------------

/** Живёт между вызовами по той же причине, что `mockSwapsLocked` выше: отметил
 *  «Разобрал» — и следующий `getBugReports` должен помнить об этом. */
interface MockBugReport {
  id: number;
  authorId: number;
  text: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedById: number | null;
}

const MOCK_BUG_REPORTS: MockBugReport[] = [
  {
    id: 1,
    authorId: 3,
    text: "Кнопка «Обмен» не открывается на Андроиде — тап проваливается сквозь карточку",
    createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    resolvedAt: null,
    resolvedById: null,
  },
  {
    id: 2,
    authorId: 5,
    text: "В расписании на выходные не видно моей смены, хотя в боте пришло напоминание",
    createdAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
    resolvedAt: new Date(Date.now() - 20 * 3600_000).toISOString(),
    resolvedById: 1,
  },
];

function bugReportView(report: MockBugReport): BugReportRow {
  return {
    id: report.id,
    authorName: personName(report.authorId),
    text: report.text,
    createdAt: report.createdAt,
    resolvedAt: report.resolvedAt,
    resolvedByName: report.resolvedById != null ? personName(report.resolvedById) : null,
  };
}

export async function mockGetBugReports(status: "open" | "all"): Promise<BugReportRow[]> {
  await delay(200);
  const rows = status === "open" ? MOCK_BUG_REPORTS.filter((r) => r.resolvedAt == null) : MOCK_BUG_REPORTS;
  // Свежие сверху — тем же порядком, что и `listBugReports` на сервере.
  return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id).map(bugReportView);
}

export async function mockResolveBugReport(id: number, resolved: boolean): Promise<{ id: number; resolvedAt: string | null }> {
  await delay(200);
  const report = MOCK_BUG_REPORTS.find((r) => r.id === id);
  if (!report) throw new Error("Багрепорт не найден");
  report.resolvedAt = resolved ? new Date().toISOString() : null;
  report.resolvedById = resolved ? MOCK_ME.id : null;
  return { id: report.id, resolvedAt: report.resolvedAt };
}

/**
 * Демо-чек-лист: три пункта и отметки в памяти.
 *
 * Пункты здесь ВЫМЫШЛЕННЫЕ и годятся только для демо — настоящую процедуру
 * пишет команда на экране «Чек-лист». В боевой базе таблица приезжает пустой
 * именно затем, чтобы правдоподобная выдумка не ушла людям как инструкция.
 */
const CHECKLIST_ITEMS: ChecklistItem[] = [
  { id: 1, title: "Обойти этаж", note: "По часовой, начиная от лифтов" },
  { id: 2, title: "Проверить переговорные", note: null },
  { id: 3, title: "Записать замечания", note: null },
];
const CHECKLIST_MARKS = new Set<string>();

export async function mockGetMyChecklist(date: string): Promise<MyChecklist> {
  await delay(120);
  return {
    date,
    required: CHECKLIST_ITEMS.length > 0,
    items: [...CHECKLIST_ITEMS],
    markedItemIds: CHECKLIST_ITEMS.filter((i) => CHECKLIST_MARKS.has(`${date}:${i.id}`)).map((i) => i.id),
    note: "Обход начинаем от лифтов, по часовой.",
    docUrl: null,
    docName: "Проверка 47.pdf",
  };
}

export async function mockMarkChecklistItem(date: string, itemId: number, done: boolean): Promise<MyChecklist> {
  await delay(120);
  const key = `${date}:${itemId}`;
  if (done) CHECKLIST_MARKS.add(key);
  else CHECKLIST_MARKS.delete(key);
  return mockGetMyChecklist(date);
}

export async function mockGetChecklistItems(): Promise<ChecklistItem[]> {
  await delay(120);
  return [...CHECKLIST_ITEMS];
}

export async function mockAddChecklistItem(title: string): Promise<ChecklistItem> {
  await delay(120);
  const item = { id: nextId++, title, note: null };
  CHECKLIST_ITEMS.push(item);
  return item;
}

export async function mockRemoveChecklistItem(id: number): Promise<ChecklistItem[]> {
  await delay(120);
  const index = CHECKLIST_ITEMS.findIndex((i) => i.id === id);
  if (index !== -1) CHECKLIST_ITEMS.splice(index, 1);
  return [...CHECKLIST_ITEMS];
}
