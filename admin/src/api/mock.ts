import { createEmployeesMock, createReadMock } from "@planer/client";
import type { EntryCategory } from "@planer/shared";
import type {
  AdminSettings,
  AdminSlotView,
  AnnouncementAudience,
  AnnouncementRecipient,
  AnnouncementResult,
  BugReportRow,
  Checklist,
  ChecklistDay,
  Employee,
  EntryRangeResult,
  FeedEvent,
  NewEntryInput,
  NewEntryRangeInput,
  NewSlotInput,
  PayrollRow,
  RosterImportPreview,
  TemplateRolesView,
  TemplateQueue,
  JournalEvent,
  JournalPage,
  Collection,
  CollectionRow,
  CollectionPreview,
  NewCollectionInput,
  CollectionPatch,
  UpcomingBirthday,
  ShiftCountsReport,
  RosterImportSummary,
  RosterPersonResolution,
  Shift,
  SwapLockResult,
  Template,
  VacantSlot,
} from "./client";
import { addDays, mondayOf, toISODate } from "../lib/week";
import {
  rotationQueue,
  describeTurn,
  daysUntilBirthday,
  formatBirthDate,
  outgoingCollectionMessage,
  paymentProgress,
  collectionTitle,
  collectionStatus,
  isCollectionActive,
  compareCollections,
  planEntryRange,
  type DayOccupancy,
  eachDayIso,
  isAbsence,
  REMINDER_HOUR_DEFAULT,
  validateReminderHour,
  autoSendDateFor,
} from "@planer/shared";
import { inviteLinkFor } from "../lib/bot";

/**
 * Realistic sample data for local development (see `client.ts`: every
 * `ApiClient` method short-circuits to this module when `import.meta.env.DEV`
 * is true). Dates are always computed relative to *this week's* Monday, so
 * the grid never goes stale.
 */

// `address` mirrors the roster's displayName here: none of the sample workers
// have a `preferredName` set, so the server's `addressOf` would fall back to
// `displayName` for all of them too. See the `Employee.address` doc comment.
// `preferredName` объявлен явно, а не опущен: контракт держит его обязательным
// и nullable — «не задано» это `null`, а не отсутствие поля.
const SEED_EMPLOYEES: readonly Employee[] = [
  { id: 1, displayName: "Аня Смирнова", isAdmin: true, isActive: true, telegramUserId: 100001, birthDate: "03-14", preferredName: null, address: "Аня Смирнова", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false, remindersEnabled: true },
  { id: 2, displayName: "Игорь Петров", isAdmin: false, isActive: true, telegramUserId: 100002, birthDate: "08-05", preferredName: null, address: "Игорь Петров", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false, remindersEnabled: true },
  { id: 3, displayName: "Марк Волков", isAdmin: false, isActive: true, telegramUserId: null, birthDate: null, preferredName: null, address: "Марк Волков", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false, remindersEnabled: true },
  { id: 4, displayName: "Даша Кузнецова", isAdmin: false, isActive: true, telegramUserId: 100004, birthDate: "12-31", preferredName: null, address: "Даша Кузнецова", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false, remindersEnabled: true },
  { id: 5, displayName: "Олег Соколов", isAdmin: false, isActive: true, telegramUserId: 100005, birthDate: null, preferredName: null, address: "Олег Соколов", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false, remindersEnabled: true },
  { id: 6, displayName: "Света Орлова", isAdmin: false, isActive: false, telegramUserId: 100006, birthDate: null, preferredName: null, address: "Света Орлова", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false, remindersEnabled: true },
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
  location?: string | null;
  unrecognisedCode?: string | null;
  employeeId: number | null;
}

let nextId = 1;
function entry(draft: EntryDraft): Shift {
  return {
    id: nextId++,
    templateId: draft.templateId ?? null,
    // Оба поля сервер отдаёт всегда, пусть и `null`. `location` в типе консоли
    // не было вовсе — место дежурства до неё не доезжало (находка в ledger).
    location: draft.location ?? null,
    unrecognisedCode: draft.unrecognisedCode ?? null,
    ...draft,
  };
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
  { sortOrder: 1, id: 1, name: "Утро", accent: "gold", start: "08:00", end: "17:00", fridayStart: "08:00", fridayEnd: "15:45", isLate: false, sendReminder: true, category: "shift", location: null },
  { sortOrder: 2, id: 2, name: "День", accent: "blue", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: false, category: "shift", location: null },
  { sortOrder: 3, id: 3, name: "Вечер", accent: "violet", start: "11:00", end: "20:00", fridayStart: "12:00", fridayEnd: "20:00", isLate: true, sendReminder: false, category: "shift", location: null },
  { sortOrder: 4, id: 4, name: "Ночь", accent: "indigo", start: "15:00", end: "23:00", fridayStart: "16:00", fridayEnd: "23:00", isLate: true, sendReminder: true, category: "shift", location: null },
  { sortOrder: 5, id: 5, name: "Дежурство · Поклонка", accent: "teal", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: true, category: "duty", location: "Поклонка" },
  { sortOrder: 6, id: 6, name: "Дежурство с 07:00", accent: "amber", start: "07:00", end: "16:00", fridayStart: "07:00", fridayEnd: "14:45", isLate: false, sendReminder: true, category: "duty", location: null },
  { sortOrder: 7, id: 7, name: "Дежурство · Телефон", accent: "rose", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: true, category: "duty", location: null },
  { sortOrder: 8, id: 8, name: "Дежурство · Вавилова 19", accent: "green", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: true, category: "duty", location: "Вавилова 19" },
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

/**
 * Мок домена read живёт в `@planer/client`, а состояние остаётся здесь.
 *
 * Так потому, что в `ENTRIES` пишут ещё не переехавшие домены — создание и
 * правка записи, распределение, импорт ростера, — и экран графика рассчитывает,
 * что правка сразу видна без перезагрузки. Массивы передаются по ссылке,
 * поэтому мутации остаются видимыми моку.
 *
 * Задержка ненулевая намеренно: в `npm run dev` она делает экраны честными.
 */
/**
 * Мок домена employees — над тем же массивом `EMPLOYEES`.
 *
 * Массив передаётся по ссылке: правки из «Работников» обязаны быть сразу видны
 * и в графике, и в отчётах, и в сборах — доменах, которые ещё не переехали.
 * Форма ответа принадлежит пакету, состояние — консоли.
 *
 * До переезда мок консоли не знал `preferredName` и на переименовании ставил
 * `address = displayName` безусловно; общий мок повторяет `addressOf` — сервер
 * ведёт себя так же.
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
      return ENTRIES;
    },
    get employees() {
      return EMPLOYEES;
    },
    // Консоль не показывает «свои смены» — поле есть только ради формы состояния.
    meId: 0,
  },
});

export async function mockGetTeamSchedule(from: string, to: string): Promise<Shift[]> {
  const { shifts } = await readMock.getTeamSchedule(from, to);
  return shifts;
}

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
  return { entry: created, notified: mockReach(input.employeeId != null ? [input.employeeId] : []) };
}

/**
 * Демо-расстановка диапазоном.
 *
 * Дни считает та же `planEntryRange`, что и сервер, а не своё похожее правило:
 * мок, считающий по-своему, — это второй источник правды, который расходится с
 * продом молча и именно там, где демо показывают человеку.
 */
export async function mockCreateEntryRange(input: NewEntryRangeInput): Promise<EntryRangeResult> {
  await delay(300);
  // Занятость с ВИДОМ, как на сервере: перезаписи мало знать «занят» — рабочую
  // запись она заменит, отпуск оставит, а день с двумя записями пропустит.
  const occupied: Record<string, DayOccupancy> = {};
  const holder = new Map<string, Shift>();
  for (const row of ENTRIES.filter((s) => s.employeeId === input.employeeId)) {
    for (const day of eachDayIso(row.date, endOf(row))) {
      if (occupied[day]) {
        occupied[day] = "ambiguous";
        holder.delete(day);
        continue;
      }
      occupied[day] = isAbsence(row.category) ? "absence" : "work";
      holder.set(day, row);
    }
  }
  const mode = input.mode ?? "fill";
  const plan = planEntryRange({
    from: input.from,
    to: input.to,
    category: input.category,
    includeWeekends: input.includeWeekends ?? false,
    mode,
    occupied,
  });
  const span = isAbsence(input.category) && input.to !== input.from;
  const rewrites = new Set(plan.rewritten);
  const fields = (date: string) => ({
    date,
    endDate: span ? input.to : null,
    start: input.start ?? null,
    end: input.end ?? null,
    category: input.category,
    title: input.title ?? null,
    templateId: input.templateId ?? null,
    employeeId: input.employeeId,
  });

  const created: Shift[] = [];
  const updated: Shift[] = [];
  for (const date of plan.days) {
    const existing = rewrites.has(date) ? holder.get(date) : undefined;
    if (!existing) {
      created.push(entry(fields(date)));
      continue;
    }
    Object.assign(existing, fields(date), { location: null, unrecognisedCode: null });
    updated.push(existing);
  }
  ENTRIES.push(...created);
  const touched = created.length + updated.length;
  return { created, updated, skipped: plan.skipped, notified: mockReach(touched > 0 ? [input.employeeId] : []) };
}

export async function mockUpdateEntry(id: number, input: NewEntryInput): Promise<{ entry: Shift; notified: { delivered: number; intended: number } }> {
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
  return { entry: updated, notified: mockReach(updated.employeeId != null ? [updated.employeeId] : []) };
}

export async function mockDeleteEntry(id: number): Promise<{ notified: { delivered: number; intended: number } }> {
  await delay(150);
  const index = ENTRIES.findIndex((s) => s.id === id);
  if (index === -1) return { notified: { delivered: 0, intended: 0 } };
  const [removed] = ENTRIES.splice(index, 1);
  return { notified: mockReach(removed?.employeeId != null ? [removed.employeeId] : []) };
}

/**
 * Демо-лента: настоящие типы и payload'ы, а не готовые фразы.
 *
 * Раньше здесь лежал текст, которого живая лента выдать не могла ни при каких
 * данных, — и демо выглядело лучше прода ровно на том месте, где прод был
 * сломан. Теперь мок проходит через `describeAuditEvent`, как настоящие события.
 */
const EVENTS: readonly FeedEvent[] = [
  {
    id: 1, type: "swap_accepted", actorName: "Игорь Петров", timeLabel: "2 часа назад",
    payload: { fromName: "Аня Смирнова", fromShift: "ср 12 августа · 09:00–18:00", toName: "Игорь Петров", toShift: "ср 12 августа · 11:00–20:00" },
  },
  {
    id: 2, type: "swap_proposed", actorName: "Марк Волков", timeLabel: "5 часов назад",
    payload: { fromName: "Марк Волков", fromShift: "пт 14 августа · 07:00–16:00", toName: "Аня Смирнова", toShift: "пт 14 августа · 09:00–18:00" },
  },
  {
    id: 3, type: "announcement_sent", actorName: "Игорь Петров", timeLabel: "вчера, 18:40",
    payload: { text: "В пятницу планёрка в 10:00", audience: "all", delivered: 12, intended: 13 },
  },
  {
    id: 4, type: "distribution_applied", actorName: "Игорь Петров", timeLabel: "вчера, 09:12",
    payload: { from: "2026-08-17", to: "2026-08-23", count: 6 },
  },
  {
    id: 5, type: "reminders_dispatched", actorName: null, timeLabel: "2 дня назад",
    payload: { forDate: "2026-08-20", sent: 12, considered: 13 },
  },
];

export async function mockGetEvents(): Promise<FeedEvent[]> {
  await delay(180);
  return [...EVENTS];
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
      { employeeId: 3, name: nameOf(3), confirmedThisMonth: 0, passedOver: 2, absence: null },
      { employeeId: 2, name: nameOf(2), confirmedThisMonth: 1, passedOver: 0, absence: null },
      { employeeId: 5, name: nameOf(5), confirmedThisMonth: 2, passedOver: 0, absence: "vacation" },
    ],
    assignees: [],
  },
  {
    slot: { id: 202, date: dayIso(6), start: "11:00", end: "19:00", title: null, location: "Склад на Вавилова", note: null, status: "open" },
    interested: [
      { employeeId: 4, name: nameOf(4), confirmedThisMonth: 0, passedOver: 2, absence: null },
      { employeeId: 5, name: nameOf(5), confirmedThisMonth: 2, passedOver: 0, absence: null },
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

export async function mockPostSlot(input: NewSlotInput): Promise<VacantSlot & { delivered: number; intended: number }> {
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
  // Two of the demo roster never linked Telegram — the notice has something to say.
  const team = EMPLOYEES.filter((e) => e.isActive);
  return { ...slot, delivered: team.filter((e) => e.telegramUserId != null).length, intended: team.length };
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

/** DEV store for who may take each preset and who asked for it. Empty = everyone. */
const TEMPLATE_ROLES = new Map<number, { pool: number[]; preference: Record<number, number> }>();
/** DEV-хранилище нормы дня. Пусто — «не считаем», как и в базе по умолчанию. */
const TEMPLATE_COVERAGE = new Map<number, number[]>();
/** DEV-хранилище своих текстов напоминания. Нет записи — стандартный текст. */
const TEMPLATE_REMINDER_TEXT = new Map<number, string>();

export async function mockGetTemplateRoles(): Promise<TemplateRolesView[]> {
  await delay(180);
  return TEMPLATES.map((template) => ({
    templateId: template.id,
    name: template.name,
    category: template.category,
    accent: template.accent,
    pool: [...(TEMPLATE_ROLES.get(template.id)?.pool ?? [])],
    preference: { ...(TEMPLATE_ROLES.get(template.id)?.preference ?? {}) },
    checklistIds: CHECKLISTS.filter((l) => l.templateIds.includes(template.id)).map((l) => l.id),
    coverage: [...(TEMPLATE_COVERAGE.get(template.id) ?? [0, 0, 0, 0, 0, 0, 0])],
    sendReminder: template.sendReminder,
    reminderText: TEMPLATE_REMINDER_TEXT.get(template.id) ?? null,
  }));
}

export async function mockSetTemplateCoverage(templateId: number, coverage: number[]): Promise<void> {
  await delay(150);
  TEMPLATE_COVERAGE.set(templateId, [...coverage]);
}

export async function mockSetTemplateReminder(
  templateId: number,
  sendReminder: boolean,
  reminderText: string | null,
): Promise<void> {
  await delay(150);
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (template) template.sendReminder = sendReminder;
  // Пустой текст — это «вернуть стандартный», ровно как на сервере.
  if (reminderText?.trim()) TEMPLATE_REMINDER_TEXT.set(templateId, reminderText.trim());
  else TEMPLATE_REMINDER_TEXT.delete(templateId);
}

export async function mockSetTemplateChecklists(templateId: number, checklistIds: readonly number[]): Promise<void> {
  await delay(150);
  for (const list of CHECKLISTS) {
    const should = checklistIds.includes(list.id);
    const has = list.templateIds.includes(templateId);
    if (should && !has) list.templateIds.push(templateId);
    else if (!should && has) list.templateIds = list.templateIds.filter((t) => t !== templateId);
  }
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
  for (const shift of ENTRIES) {
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

/** A believable log so the screen can be exercised with no backend.
 *  `actorEmployeeId` is mock-only bookkeeping — real `JournalEvent` never carries it,
 *  it exists here so `mockGetJournal` can filter by `actor` the way the server does. */
const JOURNAL: (JournalEvent & { actorEmployeeId: number | null })[] = Array.from({ length: 34 }, (_, index) => {
  const actor = EMPLOYEES[index % 3] ?? null;
  return {
    id: 1000 - index,
    type: MOCK_JOURNAL_TYPES[index % MOCK_JOURNAL_TYPES.length]!,
    createdAt: new Date(Date.now() - index * 3_600_000).toISOString(),
    actorName: actor?.displayName ?? null,
    actorEmployeeId: actor?.id ?? null,
    payload: { entryId: 500 + index, date: dayIso(index % 7) },
  };
});

export async function mockGetJournal(params: {
  types?: string[]; actor?: number; from?: string; to?: string; limit?: number; offset?: number;
}): Promise<JournalPage> {
  await delay(200);
  const types = params.types ?? [];
  const matching = JOURNAL.filter(
    (event) =>
      (types.length === 0 || types.includes(event.type)) &&
      (params.actor == null || event.actorEmployeeId === params.actor),
  );
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  // Только те, кто реально встречается в событиях — не весь ростер, иначе
  // список предлагал бы людей без единой записи в журнале.
  const availableActors = [...new Map(
    JOURNAL.filter((e) => e.actorEmployeeId != null).map((e) => [e.actorEmployeeId!, e.actorName!]),
  ).entries()]
    .map(([id, displayName]) => ({ id, displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ru"));
  return {
    total: matching.length,
    limit,
    offset,
    availableTypes: [...new Set(JOURNAL.map((e) => e.type))].sort(),
    availableActors,
    events: matching.slice(offset, offset + limit).map(({ actorEmployeeId: _actorEmployeeId, ...event }) => event),
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
    scheduleNotifiedAt: null, autoSendOn: null, autoSentAt: null, sentAt: null, sentCount: 0, sendCount: 0,
    createdAt: new Date().toISOString(), ...patch,
  };
}

function findCollection(id: number): Collection | undefined {
  return COLLECTIONS.find((c) => c.id === id);
}

/**
 * Кто «смотрит» в DEV-консоли. У неё нет своего логина — тот же приём, что уже
 * применяется у `setSwapsLock` в этом файле: «я» — первый активный админ
 * ростера. Возвращает id, которого нет ни у кого, если такого не нашлось:
 * `null` тут нельзя — им помечен общий сбор, у которого виновника нет, и
 * сравнение с ним спрятало бы все общие сборы разом, стоит демоутнуть или
 * деактивировать последнего админа через `mockSetEmployeeAdmin`/архив.
 */
function viewerEmployeeId(): number {
  return EMPLOYEES.find((e) => e.isAdmin && e.isActive)?.id ?? -1;
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
  if (!collection || collection.employeeId === viewerEmployeeId()) return undefined;
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

/**
 * Отметки о сдаче: ключ `${collectionId}:${employeeId}` → чья рука поставила.
 *
 * Счёт считается через `paymentProgress` из `@planer/shared`, а не руками: мок,
 * который считает по-своему, показывает на дев-экране не то, что покажет прод.
 */
const PAYMENTS = new Map<string, number>();

function progressOf(collectionId: number) {
  const collection = findCollection(collectionId);
  const marks = [...PAYMENTS.entries()]
    .filter(([key]) => key.startsWith(`${collectionId}:`))
    .map(([key, markedBy]) => ({ employeeId: Number(key.split(":")[1]), markedBy }));
  return paymentProgress(mockRecipients(collection?.employeeId ?? null), marks);
}

export async function mockGetCollectionPayments(id: number) {
  await delay(200);
  const progress = progressOf(id);
  return { rows: progress.rows, paidCount: progress.paidCount, total: progress.total };
}

export async function mockSetCollectionPaymentFor(id: number, employeeId: number, paid: boolean) {
  await delay(200);
  if (paid) PAYMENTS.set(`${id}:${employeeId}`, viewerEmployeeId());
  else PAYMENTS.delete(`${id}:${employeeId}`);
  const progress = progressOf(id);
  return { rows: progress.rows, paidCount: progress.paidCount, total: progress.total };
}

export async function mockSetCollectionPaid(id: number, paid: boolean) {
  await delay(200);
  if (paid) PAYMENTS.set(`${id}:${viewerEmployeeId()}`, viewerEmployeeId());
  else PAYMENTS.delete(`${id}:${viewerEmployeeId()}`);
  const progress = progressOf(id);
  return { paid, paidCount: progress.paidCount, recipientCount: progress.total };
}

export async function mockRemindUnpaid(id: number) {
  await delay(400);
  const waiting = progressOf(id).unpaid.length;
  if (waiting === 0) throw new Error("Все уже отметились.");
  return { delivered: waiting, intended: waiting };
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
  // Чекбокс шлёт `null`, чтобы выключить, или уже посчитанную дату, чтобы
  // включить обратно — сервер такую же дату не пересчитывает, а просто пишет.
  if (patch.autoSendOn !== undefined) collection.autoSendOn = patch.autoSendOn ?? null;
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
    scheduleNotifiedAt: null,
    // Вооружён сразу, как на сервере (`birthday-service.ts`): «за три дня бот
    // разошлёт» — правило дня рождения, а не отдельная настройка, которую
    // нужно не забыть включить.
    autoSendOn: autoSendDateFor(occurrence.celebratedOn, today),
    autoSentAt: null,
    sentAt: null, sentCount: 0, sendCount: 0,
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
  const created = blankCollection({
    kind: "birthday", employeeId, year: occurrence.year, celebratedOn: occurrence.celebratedOn,
    autoSendOn: autoSendDateFor(occurrence.celebratedOn, today),
  });
  COLLECTIONS.push(created);
  return created;
}

export async function mockGetBirthdays(): Promise<UpcomingBirthday[]> {
  await delay(200);
  const today = toISODate(new Date());
  // Сюрприз-правило: тикающий раз в неделю пуш видят все админы, кроме
  // именинника — даже когда именинник сам админ и смотрит список.
  return EMPLOYEES.filter((e) => e.isActive && e.birthDate && e.id !== viewerEmployeeId())
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
  if (employeeId === viewerEmployeeId()) throw new Error("not_found");
  const today = toISODate(new Date());
  const draft = birthdayRoundDraft(employeeId, today);
  if (!draft) throw new Error("У этого работника не указан день рождения");
  return previewOf(draft);
}

export async function mockSaveBirthdayRound(employeeId: number, patch: CollectionPatch): Promise<Collection> {
  await delay(180);
  if (employeeId === viewerEmployeeId()) throw new Error("not_found");
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
    .filter((c) => c.employeeId !== viewerEmployeeId())
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

export async function mockGetShiftCounts(from: string, to: string): Promise<ShiftCountsReport> {
  await delay(220);
  const inRange = ENTRIES.filter((s) => s.date >= from && s.date <= to && s.employeeId != null);
  const kinds: string[] = [];
  const rows = EMPLOYEES.filter((e) => e.isActive).map((employee) => {
    const byKind: Record<string, number> = {};
    let total = 0;
    for (const shift of inRange) {
      if (shift.employeeId !== employee.id) continue;
      // Absences are not work — same rule as the server.
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

export async function mockGetShiftCountsCsv(from: string, to: string): Promise<string> {
  const report = await mockGetShiftCounts(from, to);
  const header = ["Работник", ...report.kinds, "Всего"].join(";");
  const lines = report.rows.map((row) =>
    [row.displayName, ...report.kinds.map((kind) => String(row.byKind[kind] ?? 0)), String(row.total)].join(";"),
  );
  return [header, ...lines].join("\r\n");
}

const MOCK_ROSTER_CODES = new Set(["holiday", "k32", "k32-7", "k32-8", "k32-11", "k32-15", "dezh", "pokl", "v19", "rezerv", "otp", "event"]);

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
    unknownsMessage: null,
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
      if (employee) {
        employee.displayName = resolution.csvName;
        employee.address = resolution.csvName;
      }
    } else {
      const id = Math.max(0, ...EMPLOYEES.map((employee) => employee.id)) + 1;
      EMPLOYEES.push({
        id,
        displayName: resolution.csvName,
        preferredName: null,
        isAdmin: false,
        isActive: true,
        telegramUserId: null,
        birthDate: null,
        address: resolution.csvName,
        excludedFromAssignment: false,
        excludedFromSwaps: false,
        isObserver: false,
        selfScheduleEnabled: false, remindersEnabled: true,
      });
    }
  }
  return {
    employeesRenamed: resolutions.filter((item) => item.action === "rename").length,
    employeesCreated: resolutions.filter((item) => item.action === "create").length,
    entriesInserted: preview.entryCount,
    entriesDeleted,
    cellsPreserved: preview.preservedCount,
    swapsExpired: 0,
    unknowns: [],
    // Мок не пишет по-дневные записи из файла в ENTRIES, поэтому не знает,
    // кому реально досталось что-то новое — молчаливый {0,0} честнее выдумки.
    notified: { delivered: 0, intended: 0 },
  };
}

// --- Настройки: замок обменов ------------------------------------------------

/** DEV-хранилище тумблера. Кто менял — id, а не имя: имя может смениться позже. */
let swapsLock: { locked: boolean; updatedAt: string | null; updatedByEmployeeId: number | null } = {
  locked: false,
  updatedAt: null,
  updatedByEmployeeId: null,
};

export async function mockGetSettings(): Promise<AdminSettings> {
  await delay(150);
  return {
    swapsLocked: swapsLock.locked,
    swapsLockUpdatedAt: swapsLock.updatedAt,
    swapsLockUpdatedBy: swapsLock.updatedByEmployeeId != null ? nameOf(swapsLock.updatedByEmployeeId) : null,
    reminderHour,
    reminderHourUpdatedBy: reminderHourUpdatedBy,
  };
}

/** DEV-час рассылки: тот же, что был захардкожен до настройки. */
let reminderHour = REMINDER_HOUR_DEFAULT;
let reminderHourUpdatedBy: string | null = null;

export async function mockSetReminderHour(hour: string): Promise<void> {
  await delay(150);
  validateReminderHour(hour);
  reminderHour = hour;
  reminderHourUpdatedBy = EMPLOYEES.find((e) => e.isAdmin && e.isActive)?.displayName ?? null;
}

export async function mockSetSwapsLock(locked: boolean): Promise<SwapLockResult> {
  await delay(250);
  const actor = EMPLOYEES.find((e) => e.isAdmin && e.isActive);
  swapsLock = { locked, updatedAt: new Date().toISOString(), updatedByEmployeeId: actor?.id ?? null };
  // Мок не ведёт отдельный список заявок на обмен, поэтому cancelled всегда 0 —
  // молчаливый ноль честнее выдуманного числа (тот же приём, что у applyRosterImport выше).
  const team = EMPLOYEES.filter((e) => e.isActive);
  return {
    locked,
    cancelled: 0,
    delivered: team.filter((e) => e.telegramUserId != null).length,
    intended: team.length,
  };
}

// --- Анонсы ---------------------------------------------------------------
// Мок зеркалит `mockGetAnnouncementRecipients`/`mockSendAnnouncement` из
// `miniapp/src/api/mock.ts`: тот же пул, то же правило self-exclude. У консоли
// в DEV нет своего логина — «я» это `viewerEmployeeId()`, тот же приём, что уже
// применяется у `setSwapsLock` и сборов выше.

/**
 * Кому уйдёт «всем» — глазами отправителя. Тот же пул, что и ветка «всем» в
 * `mockSendAnnouncement` ниже: непривязанный к телеграму виден и назван, а не
 * пропадает из списка.
 */
export async function mockGetAnnouncementRecipients(): Promise<AnnouncementRecipient[]> {
  await delay(150);
  const self = viewerEmployeeId();
  return EMPLOYEES.filter((e) => e.isActive && e.id !== self).map((e) => ({
    id: e.id,
    displayName: e.displayName,
    reachable: e.telegramUserId != null,
  }));
}

/**
 * Считает адресатов по тому же `EMPLOYEES`, которым отвечает `getAdminEmployees`
 * — иначе экран в DEV показал бы одних людей, а мок отчитывался бы про других.
 * Архивный или без телеграма, даже выбранный явно, попадает в пул и в
 * `unreachable` поимённо, а не пропадает молча; отправитель исключается всегда.
 */
export async function mockSendAnnouncement(text: string, audience: AnnouncementAudience): Promise<AnnouncementResult> {
  await delay(300);
  if (!text.trim()) throw new Error("Текст объявления пустой");

  const self = viewerEmployeeId();
  const pool =
    audience === "all"
      ? EMPLOYEES.filter((e) => e.isActive && e.id !== self)
      : [...new Set(audience)]
          .map((id) => EMPLOYEES.find((e) => e.id === id))
          .filter((e): e is Employee => e != null && e.id !== self);

  const reachable = pool.filter((e) => e.isActive && e.telegramUserId != null);
  const unreachable = pool.filter((e) => !e.isActive || e.telegramUserId == null).map((e) => e.displayName);

  return { delivered: reachable.length, intended: reachable.length, unreachable };
}

// --- Баги ------------------------------------------------------------------
// Мок зеркалит `mockGetBugReports`/`mockResolveBugReport` из
// `miniapp/src/api/mock.ts`: та же форма строки, тот же порядок (свежие
// сверху), то же правило — отметка обратима, а не одноразовая.

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
    authorName: personNameOf(report.authorId) ?? "неизвестно кто",
    text: report.text,
    createdAt: report.createdAt,
    resolvedAt: report.resolvedAt,
    resolvedByName: report.resolvedById != null ? personNameOf(report.resolvedById) : null,
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
  report.resolvedById = resolved ? viewerEmployeeId() : null;
  return { id: report.id, resolvedAt: report.resolvedAt };
}

/**
 * Демо-чек-листы.
 *
 * Два — чтобы демо показывало ровно то, ради чего сущность заведена: у «с 07:00»
 * и «с 08:00» свои списки. Пункты вымышленные и живут только здесь: настоящую
 * процедуру пишет команда, и боевая база приезжает пустой именно затем.
 */
const CHECKLISTS: Checklist[] = [
  {
    id: 1,
    name: "Дежурство с 07:00",
    note: "Обход начинаем от лифтов, по часовой.",
    docUrl: null,
    docName: "Проверка 47.pdf",
    hasDoc: true,
    items: [
      { id: 1, title: "Открыть 47-й", note: "Ключ на посту" },
      { id: 2, title: "Обойти этаж", note: null },
    ],
    templateIds: [6],
  },
  {
    id: 2,
    name: "Утро с 08:00",
    note: null,
    docUrl: null,
    docName: null,
    hasDoc: false,
    items: [{ id: 3, title: "Проверить переговорные", note: null }],
    templateIds: [1],
  },
];
let nextChecklistId = 3;
let nextChecklistItemId = 4;

const findList = (id: number): Checklist => {
  const found = CHECKLISTS.find((l) => l.id === id);
  if (!found) throw new Error(`Unknown checklist ${id}`);
  return found;
};
const findByItem = (itemId: number): Checklist => {
  const found = CHECKLISTS.find((l) => l.items.some((i) => i.id === itemId));
  if (!found) throw new Error(`Unknown checklist item ${itemId}`);
  return found;
};

export async function mockGetChecklists(): Promise<Checklist[]> {
  await delay(140);
  return CHECKLISTS.map((l) => ({ ...l, items: [...l.items], templateIds: [...l.templateIds] }));
}

export async function mockCreateChecklist(name: string): Promise<Checklist> {
  await delay(140);
  const created: Checklist = { id: nextChecklistId++, name, note: null, docUrl: null, docName: null, hasDoc: false, items: [], templateIds: [] };
  CHECKLISTS.push(created);
  return { ...created };
}

export async function mockPatchChecklist(
  id: number,
  patch: { name?: string; note?: string | null; docUrl?: string | null },
): Promise<Checklist> {
  await delay(140);
  const list = findList(id);
  if (patch.name !== undefined) list.name = patch.name.trim();
  if (patch.note !== undefined) list.note = patch.note?.trim() || null;
  if (patch.docUrl !== undefined) list.docUrl = patch.docUrl?.trim() || null;
  return { ...list };
}

export async function mockDeleteChecklist(id: number): Promise<Checklist[]> {
  await delay(140);
  const index = CHECKLISTS.findIndex((l) => l.id === id);
  if (index !== -1) CHECKLISTS.splice(index, 1);
  return mockGetChecklists();
}

export async function mockRemoveChecklistDoc(id: number): Promise<Checklist> {
  await delay(140);
  const list = findList(id);
  list.docName = null;
  list.hasDoc = false;
  return { ...list };
}

/** DEV: файл никуда не пишется, но имя и признак «приложен» ведут себя как на сервере. */
export async function mockUploadChecklistDoc(id: number, file: File): Promise<Checklist> {
  await delay(220);
  const list = findList(id);
  list.docName = file.name;
  list.hasDoc = true;
  return { ...list };
}

export async function mockSetChecklistTemplates(id: number, templateIds: number[]): Promise<Checklist> {
  await delay(140);
  const list = findList(id);
  // Как на сервере: вид смены уходит только у СВОЕГО чек-листа, чужие не трогаем.
  for (const other of CHECKLISTS) {
    if (other.id === id) continue;
    other.templateIds = other.templateIds.filter((t) => !templateIds.includes(t));
  }
  list.templateIds = [...new Set(templateIds)];
  return { ...list };
}

export async function mockAddChecklistItem(checklistId: number, title: string): Promise<Checklist> {
  await delay(140);
  const list = findList(checklistId);
  list.items.push({ id: nextChecklistItemId++, title, note: null });
  return { ...list };
}

export async function mockUpdateChecklistItem(
  itemId: number,
  patch: { title?: string; note?: string | null },
): Promise<Checklist> {
  await delay(140);
  const list = findByItem(itemId);
  const item = list.items.find((i) => i.id === itemId)!;
  if (patch.title !== undefined) item.title = patch.title;
  if (patch.note !== undefined) item.note = patch.note?.trim() || null;
  return { ...list };
}

export async function mockRemoveChecklistItem(itemId: number): Promise<Checklist> {
  await delay(140);
  const list = findByItem(itemId);
  list.items = list.items.filter((i) => i.id !== itemId);
  return { ...list };
}

export async function mockReorderChecklistItem(itemId: number, to: number): Promise<Checklist> {
  await delay(140);
  const list = findByItem(itemId);
  const from = list.items.findIndex((i) => i.id === itemId);
  const [moved] = list.items.splice(from, 1);
  if (moved) list.items.splice(Math.max(0, Math.min(to, list.items.length)), 0, moved);
  return { ...list };
}

export async function mockGetChecklistDay(date: string): Promise<ChecklistDay> {
  await delay(140);
  return {
    date,
    // Три исхода рядом: так на демо-данных видно, что сводка отвечает не только
    // «сколько отмечено», но и «дойдёт ли сообщение вообще».
    people: [
      { employeeId: 3, displayName: "Волков Марк", checklistId: 1, checklistName: "Дежурство с 07:00", done: 1, total: 2, start: "07:00", delivery: "sent", sentAt: "07:02" },
      { employeeId: 4, displayName: "Егорова Аня", checklistId: 1, checklistName: "Дежурство с 07:00", done: 0, total: 2, start: "08:00", delivery: "scheduled", sentAt: null },
      { employeeId: 5, displayName: "Седов Игорь", checklistId: 1, checklistName: "Дежурство с 07:00", done: 0, total: 2, start: "07:00", delivery: "no-telegram", sentAt: null },
    ],
  };
}
