import type { EntryCategory } from "@planer/shared";
import type {
  AdminSlotView,
  CreateEmployeeResult,
  Employee,
  FeedEvent,
  NewEntryInput,
  NewSlotInput,
  PayrollRow,
  RosterImportPreview,
  RosterImportSummary,
  RosterPersonResolution,
  Shift,
  Template,
  VacantSlot,
} from "./client";
import { addDays, mondayOf, toISODate } from "../lib/week";
import { inviteLinkFor } from "../lib/bot";

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
  templateId?: number | null;
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
  return { id: nextId++, templateId: draft.templateId ?? null, ...draft };
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
  { id: 1, name: "Утро", accent: "gold", start: "08:00", end: "17:00", fridayStart: "08:00", fridayEnd: "15:45", isLate: false, sendReminder: true, category: "shift", location: null },
  { id: 2, name: "День", accent: "blue", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: false, category: "shift", location: null },
  { id: 3, name: "Вечер", accent: "violet", start: "11:00", end: "20:00", fridayStart: "12:00", fridayEnd: "20:00", isLate: true, sendReminder: false, category: "shift", location: null },
  { id: 4, name: "Ночь", accent: "indigo", start: "15:00", end: "23:00", fridayStart: "16:00", fridayEnd: "23:00", isLate: true, sendReminder: true, category: "shift", location: null },
  { id: 5, name: "Дежурство · Поклонка", accent: "teal", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: true, category: "duty", location: "Поклонка" },
  { id: 6, name: "Дежурство с 07:00", accent: "amber", start: "07:00", end: "16:00", fridayStart: "07:00", fridayEnd: "14:45", isLate: false, sendReminder: true, category: "duty", location: null },
  { id: 7, name: "Дежурство · Телефон", accent: "rose", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: true, category: "duty", location: null },
  { id: 8, name: "Дежурство · Вавилова 19", accent: "green", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: true, category: "duty", location: "Вавилова 19" },
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

export async function mockUpdateEntry(id: number, input: NewEntryInput): Promise<Shift> {
  await delay(200);
  const index = ENTRIES.findIndex((s) => s.id === id);
  if (index === -1) throw new Error(`Unknown entry ${id}`);
  const updated: Shift = {
    ...ENTRIES[index]!,
    date: input.date,
    start: input.start ?? null,
    end: input.end ?? null,
    endDate: input.endDate ?? null,
    category: input.category,
    title: input.title ?? null,
    employeeId: input.employeeId ?? null,
  };
  ENTRIES[index] = updated;
  return updated;
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

export async function mockRenameEmployee(id: number, displayName: string): Promise<void> {
  await delay(150);
  const employee = EMPLOYEES.find((e) => e.id === id);
  if (employee) employee.displayName = displayName;
}

/** Mirrors the server: move one worker, then renumber everyone contiguously. */
export async function mockReorderEmployee(id: number, position: number): Promise<Employee[]> {
  await delay(150);
  const active = EMPLOYEES.filter((e) => e.isActive);
  const from = active.findIndex((e) => e.id === id);
  if (from === -1) throw new Error("Работник не найден");
  const target = Math.min(Math.max(Math.trunc(position), 1), active.length) - 1;
  const [moved] = active.splice(from, 1);
  active.splice(target, 0, moved!);
  // Rewrite EMPLOYEES so every screen reading it sees the new order.
  const archived = EMPLOYEES.filter((e) => !e.isActive);
  EMPLOYEES.length = 0;
  EMPLOYEES.push(...active, ...archived);
  return [...active];
}

export async function mockGetEmployeeInvite(id: number, regenerate = false): Promise<{ inviteToken: string; inviteLink: string | null }> {
  await delay(150);
  const seed = `${id}-${regenerate ? "regen" : "keep"}`;
  const inviteToken = seed.padEnd(12, "0").slice(0, 12);
  return { inviteToken, inviteLink: inviteLinkFor(inviteToken) };
}

/**
 * In-memory "Работа в выходные дни" (weekend marketplace) store for local development —
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
      { employeeId: 3, name: nameOf(3), confirmedThisMonth: 0, passedOver: 2 },
      { employeeId: 2, name: nameOf(2), confirmedThisMonth: 1, passedOver: 0 },
      { employeeId: 5, name: nameOf(5), confirmedThisMonth: 2, passedOver: 0 },
    ],
    assignees: [],
  },
  {
    slot: { id: 202, date: dayIso(6), start: "11:00", end: "19:00", title: null, location: "Склад на Вавилова", note: null, status: "open" },
    interested: [
      { employeeId: 4, name: nameOf(4), confirmedThisMonth: 0, passedOver: 2 },
      { employeeId: 5, name: nameOf(5), confirmedThisMonth: 2, passedOver: 0 },
    ],
    assignees: [],
  },
  {
    slot: { id: 203, date: dayIso(12), start: "09:00", end: "15:00", title: "Инвентаризация", location: null, note: "Полдня, оплата в двойном размере", status: "open" },
    interested: [],
    assignees: [],
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
    interested: [...s.interested].sort(
      (a, b) => a.confirmedThisMonth - b.confirmedThisMonth || b.passedOver - a.passedOver,
    ),
    assignees: [...s.assignees],
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
  WEEKEND_SLOTS.unshift({ slot, interested: [], assignees: [] });
  return slot;
}

let nextAssignmentId = 900;

export async function mockAssignSlot(slotId: number, employeeId: number): Promise<void> {
  await delay(250);
  const entry = WEEKEND_SLOTS.find((s) => s.slot.id === slotId);
  if (!entry || entry.assignees.some((a) => a.employeeId === employeeId)) return;
  // The slot stays open — it may need more than one person.
  entry.assignees.push({ assignmentId: nextAssignmentId++, employeeId, name: nameOf(employeeId), status: "offered" });
  // Mirror the real flow's eventual outcome for the demo ledger.
  const hours = durationHoursOf(entry.slot.start, entry.slot.end);
  PAYROLL.push({ employeeId, employeeName: nameOf(employeeId), date: entry.slot.date, hours });
}

export async function mockUnassignSlot(assignmentId: number): Promise<void> {
  await delay(200);
  for (const entry of WEEKEND_SLOTS) {
    const i = entry.assignees.findIndex((a) => a.assignmentId === assignmentId);
    if (i !== -1) {
      entry.assignees.splice(i, 1);
      return;
    }
  }
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

/** The дд.мм.гггг × ФИО matrix the real roster import/export uses — a minimal fixture is enough for DEV. */
export async function mockGetRosterCsv(_from: string, _to: string): Promise<string> {
  await delay(200);
  return ";01.06.2026\nМок Пользователь;k32";
}

const MOCK_ROSTER_CODES = new Set(["holiday", "k32", "k32-7", "k32-8", "k32-11", "k32-15", "dezh", "pokl", "v19", "otp", "event"]);

function mockIsoDate(value: string): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (!match) throw new Error(`Некорректная дата в CSV: ${value}`);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/** What the export writes for an entry the roster vocabulary can't express. On import
 *  it means "there is something on that day — leave it alone", never "bad code". */
const MOCK_PRESERVE_CODE = "?";

/** DEV mirror of the server's own rule: only entries the codec can write back are the
 *  import's to replace. Everything else — weekend work, a one-off custom time, an
 *  outing with a free-text title — survives an overwrite untouched.
 *  The server keys on templateId; the DEV fixture predates presets, so key on the
 *  preset NAME instead, which is what the codec ultimately resolves to anyway. */
function mockIsEncodable(shift: Shift): boolean {
  if (shift.category === "vacation" || shift.category === "business_trip") return true;
  if (shift.category !== "shift" && shift.category !== "duty") return false;
  return TEMPLATES.some((template) => template.name === shift.title);
}

function mockParseRoster(csv: string) {
  const lines = csv.replace(/^﻿/, "").split(/\r\n|\r|\n/).filter(Boolean);
  const header = lines[0]?.split(";") ?? [];
  const dates = header.slice(1).map(mockIsoDate);
  if (dates.length === 0) throw new Error("В CSV нет дат");
  const people = lines.slice(1).map((line, index) => {
    const cells = line.split(";");
    if (cells.length - 1 !== dates.length) {
      const name = cells[0]?.trim() ?? "";
      throw new Error(`строка ${index + 2}${name ? ` («${name}»)` : ""}: ${cells.length - 1} клеток, а в шапке ${dates.length} дат`);
    }
    return { name: cells[0]?.trim() ?? "", codes: cells.slice(1) };
  });
  return { dates, people };
}

export async function mockPreviewRosterImport(csv: string): Promise<RosterImportPreview> {
  await delay(220);
  const { dates, people } = mockParseRoster(csv);
  const unknowns = people.flatMap((person) =>
    person.codes.flatMap((code, index) =>
      code && code !== MOCK_PRESERVE_CODE && !MOCK_ROSTER_CODES.has(code)
        ? [{ name: person.name, date: dates[index] ?? dates[0]!, code }]
        : [],
    ),
  );
  if (unknowns.length > 0) {
    const [y, m, d] = (unknowns[0]!.date).split("-");
    throw new Error(`Не понял коды в файле: ${unknowns[0]!.name}, ${d}.${m}.${y} — «${unknowns[0]!.code}».`);
  }
  const from = dates[0]!;
  const to = dates.at(-1)!;
  return {
    from,
    to,
    entryCount: people.reduce(
      (sum, person) =>
        sum + person.codes.filter((code) => code && code !== "holiday" && code !== MOCK_PRESERVE_CODE).length,
      0,
    ),
    people: people.map((person) => ({
      csvName: person.name,
      suggestedEmployeeId: EMPLOYEES.find((employee) => employee.isActive && employee.displayName === person.name)?.id ?? null,
    })),
    unknowns: [],
    preservedCount: people.reduce(
      (sum, person) => sum + person.codes.filter((code) => code === MOCK_PRESERVE_CODE).length,
      0,
    ),
    existingCount: ENTRIES.filter((s) => overlapsRange(s, from, to)).length,
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
    for (let i = ENTRIES.length - 1; i >= 0; i--) {
      const shift = ENTRIES[i]!;
      if (overlapsRange(shift, preview.from, preview.to) && mockIsEncodable(shift)) {
        ENTRIES.splice(i, 1);
        entriesDeleted++;
      }
    }
  }

  for (const resolution of resolutions) {
    if (resolution.action === "rename") {
      const employee = EMPLOYEES.find((item) => item.id === resolution.employeeId);
      if (employee) employee.displayName = resolution.csvName;
    } else {
      const id = Math.max(0, ...EMPLOYEES.map((employee) => employee.id)) + 1;
      EMPLOYEES.push({
        id,
        displayName: resolution.csvName,
        isAdmin: false,
        isActive: true,
        telegramUserId: null,
      });
    }
  }
  return {
    employeesRenamed: resolutions.filter((item) => item.action === "rename").length,
    employeesCreated: resolutions.filter((item) => item.action === "create").length,
    entriesInserted: preview.entryCount,
    entriesDeleted,
    cellsPreserved: preview.preservedCount,
    unknowns: [],
  };
}
