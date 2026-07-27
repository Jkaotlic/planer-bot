import type { Category } from "../categories";
import type {
  AdminSlotView,
  CreateEmployeeResult,
  DistributeResult,
  Employee,
  Me,
  NewEntryInput,
  NewSlotInput,
  PayrollRow,
  RosterImportPreview,
  RosterImportSummary,
  RosterPersonResolution,
  Shift,
  SwapDirection,
  SwapRequest,
  SwapShiftSummary,
  SwapStatus,
  TeamSchedule,
  Template,
  VacantSlot,
  WeekendSlotView,
  WeekendOffer,
} from "./client";
import { addDays, mondayOf, toISODate } from "../lib/week";
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
export const MOCK_ME: Me = { id: 1, displayName: "Аня Смирнова", isAdmin: true };

/**
 * In-memory roster shared by the worker screens (name lookups) and the admin
 * "Работники" screen (full rows). Mutated live by create/archive/restore so
 * both surfaces update without a reload. Ids 1–5 mirror the worker mock's
 * original PEOPLE map; id 6 exercises the archive list and id 7 the active
 * employee-without-shifts state.
 */
const EMPLOYEES: Employee[] = [
  { id: 1, displayName: "Аня Смирнова", isAdmin: true, isActive: true, telegramUserId: 100001 },
  { id: 2, displayName: "Игорь Петров", isAdmin: false, isActive: true, telegramUserId: 100002 },
  { id: 3, displayName: "Марк Волков", isAdmin: false, isActive: true, telegramUserId: null },
  { id: 4, displayName: "Даша Кузнецова", isAdmin: false, isActive: true, telegramUserId: 100004 },
  { id: 5, displayName: "Олег Соколов", isAdmin: false, isActive: true, telegramUserId: 100005 },
  { id: 6, displayName: "Света Орлова", isAdmin: false, isActive: false, telegramUserId: 100006 },
  { id: 7, displayName: "Нина Белова", isAdmin: false, isActive: true, telegramUserId: 100007 },
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

function byDateThenStart(a: Shift, b: Shift): number {
  return a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? "");
}

export async function mockGetMe(): Promise<Me> {
  await delay(150);
  return MOCK_ME;
}

export async function mockGetMyShifts(from: string): Promise<Shift[]> {
  await delay(300);
  return ALL_ENTRIES.filter((s) => s.employeeId === MOCK_ME.id && endOf(s) >= from).sort(byDateThenStart);
}

export async function mockGetTeamSchedule(from: string, to: string): Promise<TeamSchedule> {
  await delay(350);
  return {
    employees: EMPLOYEES
      .filter((employee) => employee.isActive)
      .map((employee, rosterOrder) => ({
        id: employee.id,
        displayName: employee.displayName,
        rosterOrder,
      })),
    shifts: ALL_ENTRIES.filter((entry) => overlapsRange(entry, from, to)).sort(byDateThenStart),
  };
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
  return { date: shift.date, start: shift.start, end: shift.end, title: shift.title };
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

export async function mockGetAdminEmployees(): Promise<Employee[]> {
  await delay(150);
  return EMPLOYEES.map((e) => ({ ...e }));
}

export async function mockCreateEmployee(name: string): Promise<CreateEmployeeResult> {
  await delay(250);
  const id = Math.max(0, ...EMPLOYEES.map((e) => e.id)) + 1;
  const employee: Employee = { id, displayName: name, isAdmin: false, isActive: true, telegramUserId: null };
  EMPLOYEES.push(employee);
  const inviteToken = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  return { employee, inviteToken, inviteLink: inviteLinkFor(inviteToken) };
}

export async function mockArchiveEmployee(id: number): Promise<void> {
  await delay(150);
  const employee = EMPLOYEES.find((e) => e.id === id);
  if (employee) employee.isActive = false;
}

export async function mockRestoreEmployee(id: number): Promise<void> {
  await delay(150);
  const employee = EMPLOYEES.find((e) => e.id === id);
  if (employee) employee.isActive = true;
}

export async function mockSetEmployeeAdmin(id: number, isAdmin: boolean): Promise<void> {
  await delay(150);
  const employee = EMPLOYEES.find((e) => e.id === id);
  if (employee) employee.isAdmin = isAdmin;
}

export async function mockRenameEmployee(id: number, displayName: string): Promise<void> {
  await delay(150);
  const employee = EMPLOYEES.find((e) => e.id === id);
  if (employee) employee.displayName = displayName;
}

export async function mockGetEmployeeInvite(id: number, regenerate = false): Promise<{ inviteToken: string; inviteLink: string | null }> {
  await delay(150);
  const inviteToken = `${id}-${regenerate ? "regen" : "keep"}`.padEnd(12, "0").slice(0, 12);
  return { inviteToken, inviteLink: inviteLinkFor(inviteToken) };
}

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

export async function mockGetTemplates(): Promise<Template[]> {
  await delay(120);
  return [...TEMPLATES];
}

export async function mockCreateEntry(input: NewEntryInput): Promise<Shift> {
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
    employeeName: input.employeeId != null ? personName(input.employeeId) : undefined,
  };
  ALL_ENTRIES.push(created);
  return created;
}

export async function mockUpdateEntry(id: number, input: NewEntryInput): Promise<Shift> {
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
  return shift;
}

export async function mockDeleteEntry(id: number): Promise<void> {
  await delay(150);
  const index = ALL_ENTRIES.findIndex((s) => s.id === id);
  if (index !== -1) ALL_ENTRIES.splice(index, 1);
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
  for (const shift of ALL_ENTRIES.filter((s) => s.employeeId == null && overlapsRange(s, from, to))) {
    let best = activeIds[0];
    if (best == null) break; // no active workers to distribute to
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
  return { applied: apply, assignments };
}

// --- Работа в выходные дни (admin) + учёт часов ------------------------------

let nextAdminSlotId = 300;
const ADMIN_SLOTS: AdminSlotView[] = [
  {
    slot: { id: 301, date: dayIso(5), start: "10:00", end: "18:00", title: "Ярмарка выходного дня", location: "ТЦ Авиапарк", note: "Нужен один человек на стенд", status: "open" },
    interested: [
      { employeeId: 3, name: personName(3), confirmedThisMonth: 0, passedOver: 2 },
      { employeeId: 2, name: personName(2), confirmedThisMonth: 1, passedOver: 0 },
      { employeeId: 5, name: personName(5), confirmedThisMonth: 2, passedOver: 0 },
    ],
    assignees: [],
  },
  {
    slot: { id: 302, date: dayIso(6), start: "11:00", end: "19:00", title: null, location: "Склад на Вавилова", note: null, status: "open" },
    interested: [
      { employeeId: 4, name: personName(4), confirmedThisMonth: 0, passedOver: 2 },
      { employeeId: 5, name: personName(5), confirmedThisMonth: 2, passedOver: 0 },
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

export async function mockPostSlot(input: NewSlotInput): Promise<VacantSlot> {
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
  return slot;
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

const MOCK_ROSTER_CODES = new Set(["holiday", "k32", "k32-7", "k32-8", "k32-11", "k32-15", "dezh", "pokl", "v19", "otp", "event"]);
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
    preservedCount: people.reduce((sum, p) => sum + p.codes.filter((c) => c === MOCK_PRESERVE_CODE).length, 0),
    existingCount: ALL_ENTRIES.filter((s) => overlapsRange(s, from, to)).length,
  };
}

export async function mockApplyRosterImport(
  csv: string,
  resolutions: RosterPersonResolution[],
  overwrite = false,
): Promise<RosterImportSummary> {
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
      if (employee) employee.displayName = resolution.csvName;
    } else {
      EMPLOYEES.push({
        id: Math.max(0, ...EMPLOYEES.map((e) => e.id)) + 1,
        displayName: resolution.csvName,
        isAdmin: false,
        isActive: true,
        telegramUserId: null,
      });
    }
  }
  return {
    employeesRenamed: resolutions.filter((r) => r.action === "rename").length,
    employeesCreated: resolutions.filter((r) => r.action === "create").length,
    entriesInserted: preview.entryCount,
    entriesDeleted,
    cellsPreserved: preview.preservedCount,
    unknowns: [],
  };
}
