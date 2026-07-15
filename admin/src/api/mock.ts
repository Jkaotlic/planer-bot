import type { EntryCategory } from "@planer/shared";
import type {
  AdminSlotView,
  CreateEmployeeResult,
  Employee,
  FeedEvent,
  NewEntryInput,
  NewSlotInput,
  PayrollRow,
  Shift,
  Template,
  VacantSlot,
} from "./client";
import { addDays, mondayOf, toISODate } from "../lib/week";

/**
 * Realistic sample data for local development (see `client.ts`: every
 * `ApiClient` method short-circuits to this module when `import.meta.env.DEV`
 * is true). Dates are always computed relative to *this week's* Monday, so
 * the grid never goes stale.
 */

const SEED_EMPLOYEES: readonly Employee[] = [
  { id: 1, displayName: "Аня Смирнова", isAdmin: true, isActive: true, telegramUserId: 100001 },
  { id: 2, displayName: "Игорь Петров", isAdmin: false, isActive: true, telegramUserId: 100002 },
  { id: 3, displayName: "Марк Волков", isAdmin: false, isActive: true, telegramUserId: null },
  { id: 4, displayName: "Даша Кузнецова", isAdmin: false, isActive: true, telegramUserId: 100004 },
  { id: 5, displayName: "Олег Соколов", isAdmin: false, isActive: true, telegramUserId: 100005 },
  { id: 6, displayName: "Света Орлова", isAdmin: false, isActive: false, telegramUserId: 100006 },
];

/** In-memory employee store — mutated live by create/archive/restore so the Работники screen (and the schedule, which only shows active workers) update without a reload. */
const EMPLOYEES: Employee[] = [...SEED_EMPLOYEES];

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
  category: EntryCategory;
  title: string | null;
  employeeId: number | null;
}

let nextId = 1;
function entry(draft: EntryDraft): Shift {
  return { id: nextId++, ...draft };
}

// A full week across the 5-person team (Пн=0 .. Вс=6), touching every
// `EntryCategory` at least once.
const SEED_ENTRIES: Shift[] = [
  // Пн
  entry({ date: dayIso(0), start: "08:00", end: "17:00", endDate: null, category: "shift", title: "Утро", employeeId: 1 }),
  entry({ date: dayIso(0), start: "08:00", end: "17:00", endDate: null, category: "shift", title: "Утро", employeeId: 2 }),
  entry({ date: dayIso(0), start: "09:00", end: "18:00", endDate: null, category: "shift", title: "День", employeeId: 4 }),

  // Вт–Ср: Игорь в командировке (одна запись на диапазон)
  entry({ date: dayIso(1), start: null, end: null, endDate: dayIso(2), category: "business_trip", title: null, employeeId: 2 }),
  // Вт
  entry({ date: dayIso(1), start: "12:00", end: "21:00", endDate: null, category: "shift", title: "День", employeeId: 3 }),
  entry({ date: dayIso(1), start: "17:00", end: "23:00", endDate: null, category: "shift", title: "Вечер", employeeId: 5 }),

  // Ср
  entry({ date: dayIso(2), start: "09:00", end: "18:00", endDate: null, category: "shift", title: "День", employeeId: 1 }),
  entry({ date: dayIso(2), start: "10:00", end: "19:00", endDate: null, category: "offsite", title: "Ярмарка вакансий", employeeId: 4 }),

  // Чт–Пт: Аня в отпуске (одна запись на диапазон)
  entry({ date: dayIso(3), start: null, end: null, endDate: dayIso(4), category: "vacation", title: null, employeeId: 1 }),
  // Чт
  entry({ date: dayIso(3), start: "09:00", end: "21:00", endDate: null, category: "duty", title: "Дежурство · Вавилова", employeeId: 3 }),
  entry({ date: dayIso(3), start: "08:00", end: "17:00", endDate: null, category: "shift", title: "Утро", employeeId: 5 }),

  // Пт
  entry({ date: dayIso(4), start: "09:00", end: "18:00", endDate: null, category: "shift", title: "День", employeeId: 2 }),
  entry({ date: dayIso(4), start: "08:00", end: "17:00", endDate: null, category: "shift", title: "Утро", employeeId: 4 }),

  // Сб–Вс
  entry({ date: dayIso(5), start: "11:00", end: "20:00", endDate: null, category: "shift", title: "Вечер", employeeId: 1 }),
  entry({ date: dayIso(6), start: "10:00", end: "18:00", endDate: null, category: "weekend_work", title: null, employeeId: 5 }),
];

/** In-memory schedule store — mutated live by `mockCreateEntry`/`mockDeleteEntry` so the grid reflects changes without a reload. */
const ENTRIES: Shift[] = [...SEED_ENTRIES];

export const TEMPLATES: readonly Template[] = [
  { id: 1, name: "Утро", start: "08:00", end: "17:00", fridayStart: "08:00", fridayEnd: "15:45", isLate: false, sendReminder: true },
  { id: 2, name: "День", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: false },
  { id: 3, name: "Вечер", start: "11:00", end: "20:00", fridayStart: "12:00", fridayEnd: "20:00", isLate: true, sendReminder: false },
  { id: 4, name: "Ночь", start: "15:00", end: "23:00", fridayStart: "16:00", fridayEnd: "23:00", isLate: true, sendReminder: true },
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

export async function mockGetEmployees(): Promise<Employee[]> {
  await delay(150);
  return [...EMPLOYEES];
}

export async function mockGetTeamSchedule(from: string, to: string): Promise<Shift[]> {
  await delay(300);
  return ENTRIES.filter((s) => overlapsRange(s, from, to)).sort(byDateThenStart);
}

export async function mockGetTemplates(): Promise<Template[]> {
  await delay(120);
  return [...TEMPLATES];
}

export async function mockCreateEntry(input: NewEntryInput): Promise<Shift> {
  await delay(250);
  const created = entry({
    date: input.date,
    start: input.start ?? null,
    end: input.end ?? null,
    endDate: input.endDate ?? null,
    category: input.category,
    title: input.title ?? null,
    employeeId: input.employeeId ?? null,
  });
  ENTRIES.push(created);
  return created;
}

export async function mockDeleteEntry(id: number): Promise<void> {
  await delay(150);
  const index = ENTRIES.findIndex((s) => s.id === id);
  if (index !== -1) ENTRIES.splice(index, 1);
}

const EVENTS: readonly FeedEvent[] = [
  { id: 1, kind: "success", text: "**Аня** ⇄ **Игорь** — обмен состоялся", timeLabel: "2 часа назад" },
  { id: 2, kind: "pending", text: "**Марк** → **Аня** — ждёт ответа", timeLabel: "5 часов назад" },
  { id: 3, kind: "error", text: "**Олег** отклонил обмен с **Дашей**", timeLabel: "вчера, 18:40" },
  { id: 4, kind: "info", text: "Добавлено 6 смен на неделю", timeLabel: "вчера, 09:12" },
  { id: 5, kind: "success", text: "**Даша** ⇄ **Олег** — обмен состоялся", timeLabel: "2 дня назад" },
];

export async function mockGetEvents(): Promise<FeedEvent[]> {
  await delay(180);
  return [...EVENTS];
}

export async function mockCreateEmployee(name: string): Promise<CreateEmployeeResult> {
  await delay(250);
  const id = Math.max(0, ...EMPLOYEES.map((e) => e.id)) + 1;
  const employee: Employee = { id, displayName: name, isAdmin: false, isActive: true, telegramUserId: null };
  EMPLOYEES.push(employee);
  const inviteToken = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  return { employee, inviteToken, inviteLink: null };
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

/**
 * In-memory "Биржа" (weekend marketplace) store for local development —
 * open vacant slots with their fairness-ranked interested workers, plus a
 * payroll ledger of already-confirmed weekend work. Mutated live by
 * post/assign so the screen updates without a reload.
 */

function nameOf(employeeId: number): string {
  return EMPLOYEES.find((e) => e.id === employeeId)?.displayName ?? "Без имени";
}

let nextSlotId = 200;
const WEEKEND_SLOTS: AdminSlotView[] = [
  {
    slot: { id: 201, date: dayIso(5), start: "10:00", end: "18:00", title: "Ярмарка выходного дня", location: "ТЦ Авиапарк", note: "Нужен один человек на стенд", status: "open" },
    interested: [
      { employeeId: 3, name: nameOf(3), confirmedThisMonth: 0 },
      { employeeId: 2, name: nameOf(2), confirmedThisMonth: 1 },
      { employeeId: 5, name: nameOf(5), confirmedThisMonth: 2 },
    ],
  },
  {
    slot: { id: 202, date: dayIso(6), start: "11:00", end: "19:00", title: null, location: "Склад на Вавилова", note: null, status: "open" },
    interested: [
      { employeeId: 4, name: nameOf(4), confirmedThisMonth: 0 },
      { employeeId: 5, name: nameOf(5), confirmedThisMonth: 2 },
    ],
  },
  {
    slot: { id: 203, date: dayIso(12), start: "09:00", end: "15:00", title: "Инвентаризация", location: null, note: "Полдня, оплата в двойном размере", status: "open" },
    interested: [],
  },
];

/** Confirmed weekend work already logged this period — the payroll ledger. */
const PAYROLL: PayrollRow[] = [
  { employeeId: 5, employeeName: nameOf(5), date: dayIso(-9), hours: 8 },
  { employeeId: 4, employeeName: nameOf(4), date: dayIso(-2), hours: 6 },
  { employeeId: 5, employeeName: nameOf(5), date: dayIso(-1), hours: 8 },
];

export async function mockGetWeekendSlots(): Promise<AdminSlotView[]> {
  await delay(250);
  return WEEKEND_SLOTS.filter((s) => s.slot.status === "open").map((s) => ({
    slot: s.slot,
    interested: [...s.interested].sort((a, b) => a.confirmedThisMonth - b.confirmedThisMonth),
  }));
}

export async function mockPostSlot(input: NewSlotInput): Promise<VacantSlot> {
  await delay(250);
  const slot: VacantSlot = {
    id: nextSlotId++,
    date: input.date,
    start: input.start,
    end: input.end,
    title: input.title?.trim() ? input.title.trim() : null,
    location: input.location?.trim() ? input.location.trim() : null,
    note: input.note?.trim() ? input.note.trim() : null,
    status: "open",
  };
  WEEKEND_SLOTS.unshift({ slot, interested: [] });
  return slot;
}

export async function mockAssignSlot(slotId: number, employeeId: number): Promise<void> {
  await delay(250);
  const entry = WEEKEND_SLOTS.find((s) => s.slot.id === slotId);
  if (!entry) return;
  entry.slot = { ...entry.slot, status: "assigned" }; // drops out of the open list
  // Mirror the real flow's eventual outcome for the demo ledger.
  const hours = durationHoursOf(entry.slot.start, entry.slot.end);
  PAYROLL.push({ employeeId, employeeName: nameOf(employeeId), date: entry.slot.date, hours });
}

function durationHoursOf(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  let endMin = Number(end.split(":")[0]) * 60 + Number(end.split(":")[1]);
  const startMin = (sh ?? 0) * 60 + (sm ?? 0);
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
