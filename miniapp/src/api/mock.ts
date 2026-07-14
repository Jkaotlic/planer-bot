import type { Category } from "../categories";
import type { Me, Shift, SwapDirection, SwapRequest, SwapShiftSummary, SwapStatus } from "./client";
import { addDays, mondayOf, toISODate } from "../lib/week";

/**
 * Realistic sample data for local development (see `client.ts`: every
 * `ApiClient` method short-circuits to this module when `import.meta.env.DEV`
 * is true). Dates are always computed relative to *this week's* Monday, so
 * the screens never go stale.
 */

export const MOCK_ME: Me = { id: 1, displayName: "Аня Смирнова", isAdmin: false };

const PEOPLE: ReadonlyMap<number, string> = new Map([
  [1, "Аня Смирнова"],
  [2, "Игорь Петров"],
  [3, "Марк Волков"],
  [4, "Даша Кузнецова"],
  [5, "Олег Соколов"],
]);

function personName(employeeId: number): string {
  return PEOPLE.get(employeeId) ?? "Без имени";
}

const MONDAY = mondayOf(new Date());
/** ISO date for "Monday + offset days" of the current week. */
function dayIso(offsetFromMonday: number): string {
  return toISODate(addDays(MONDAY, offsetFromMonday));
}

interface EntryDraft {
  date: string;
  start: string | null;
  end: string | null;
  endDate: string | null;
  category: Category;
  title: string | null;
  employeeId: number;
}

let nextId = 1;
function entry(draft: EntryDraft): Shift {
  return { id: nextId++, employeeName: personName(draft.employeeId), ...draft };
}

// A full week across a 5-person team (Пн=0 .. Вс=6). Аня (id 1) is the
// caller — her entries double as "my shifts" and appear in the team view.
const ALL_ENTRIES: readonly Shift[] = [
  // Пн
  entry({ date: dayIso(0), start: "08:00", end: "17:00", endDate: null, category: "shift", title: "Утро", employeeId: 1 }),
  entry({ date: dayIso(0), start: "08:00", end: "17:00", endDate: null, category: "shift", title: "Утро", employeeId: 2 }),
  entry({ date: dayIso(0), start: "09:00", end: "18:00", endDate: null, category: "shift", title: "День", employeeId: 4 }),

  // Вт–Ср: Игорь в командировке (один интервал, показывается в оба дня)
  entry({ date: dayIso(1), start: null, end: null, endDate: dayIso(2), category: "business_trip", title: null, employeeId: 2 }),
  // Вт
  entry({ date: dayIso(1), start: "12:00", end: "21:00", endDate: null, category: "shift", title: "День", employeeId: 3 }),
  entry({ date: dayIso(1), start: "17:00", end: "23:00", endDate: null, category: "shift", title: "Вечер", employeeId: 5 }),

  // Ср
  entry({ date: dayIso(2), start: "09:00", end: "18:00", endDate: null, category: "shift", title: "День", employeeId: 1 }),
  entry({ date: dayIso(2), start: "10:00", end: "19:00", endDate: null, category: "offsite", title: null, employeeId: 4 }),

  // Чт–Пт: Аня в отпуске (один интервал, показывается в оба дня)
  entry({ date: dayIso(3), start: null, end: null, endDate: dayIso(4), category: "vacation", title: null, employeeId: 1 }),
  // Чт
  entry({ date: dayIso(3), start: "09:00", end: "21:00", endDate: null, category: "duty", title: "Дежурство · Вавилова", employeeId: 3 }),
  entry({ date: dayIso(3), start: "08:00", end: "17:00", endDate: null, category: "shift", title: "Утро", employeeId: 5 }),

  // Пт
  entry({ date: dayIso(4), start: "09:00", end: "18:00", endDate: null, category: "shift", title: "День", employeeId: 2 }),
  entry({ date: dayIso(4), start: "08:00", end: "17:00", endDate: null, category: "shift", title: "Утро", employeeId: 4 }),

  // Сб
  entry({ date: dayIso(5), start: "11:00", end: "20:00", endDate: null, category: "shift", title: "Вечер", employeeId: 1 }),

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

export async function mockGetTeamSchedule(from: string, to: string): Promise<Shift[]> {
  await delay(350);
  return ALL_ENTRIES.filter((s) => overlapsRange(s, from, to)).sort(byDateThenStart);
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
