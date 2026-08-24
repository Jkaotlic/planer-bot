import { categoryLabel, type EntryCategory, type TemplateAccent } from "./category";
import {
  exactSchedulePalette,
  UNRECOGNISED_SCHEDULE_PALETTE,
  type SchedulePalette,
} from "./schedule-palette";
import { addDaysIso } from "./week-dates";

/**
 * Сетка «команда × неделя»: какая запись попадает в какую клетку, какой буквой
 * и каким цветом рисуется, и что написать под сеткой.
 *
 * Живёт в shared, потому что этим заняты двое: экран «Команда → Неделя» в
 * мини-аппе и картинка, которую бот присылает по /week. Двух реализаций быть не
 * может — они разъедутся по буквам и цветам, причём молча.
 *
 * Типы входа структурные, а не импортированные из мини-аппа: одна и та же
 * функция получает то строку из БД, то разобранный JSON, и требовать от них
 * общий номинальный тип значило бы гонять данные через конвертер впустую.
 */
export interface ScheduleEntryLike {
  employeeId: number | null;
  date: string;
  endDate: string | null;
  start: string | null;
  end: string | null;
  category: EntryCategory;
  title: string | null;
  templateId: number | null;
  unrecognisedCode?: string | null;
}

/** Минимум пресета: сетка берёт из него имя, цвет и порядок сортировки. */
export interface SchedulePresetLike {
  id: number;
  name: string;
  accent: TemplateAccent;
  sortOrder: number;
}

/** Минимум человека: одна строка сетки. */
export interface TeamMemberLike {
  id: number;
  displayName: string;
  rosterOrder: number | null;
}

export interface TeamEntryView<E extends ScheduleEntryLike = ScheduleEntryLike> {
  shift: E;
  title: string;
  palette: SchedulePalette | null;
}

export interface WeekCell<E extends ScheduleEntryLike = ScheduleEntryLike> {
  date: string;
  entries: TeamEntryView<E>[];
  primary: TeamEntryView<E> | null;
  extraCount: number;
}

export interface WeekRow<E extends ScheduleEntryLike = ScheduleEntryLike> {
  employeeId: number | null;
  displayName: string;
  cells: WeekCell<E>[];
}

export interface WeekModel<E extends ScheduleEntryLike = ScheduleEntryLike> {
  days: string[];
  rows: WeekRow<E>[];
}

export function coversDate(shift: ScheduleEntryLike, date: string): boolean {
  return shift.date <= date && (shift.endDate ?? shift.date) >= date;
}

export function splitDisplayName(displayName: string): { surname: string; rest: string } {
  const [surname = displayName, ...rest] = displayName.trim().split(/\s+/);
  return { surname, rest: rest.join(" ") };
}

function templateFor<E extends ScheduleEntryLike>(
  shift: E,
  templates: readonly SchedulePresetLike[],
): SchedulePresetLike | undefined {
  return shift.templateId == null
    ? undefined
    : templates.find((template) => template.id === shift.templateId);
}

export function toEntryView<E extends ScheduleEntryLike>(
  shift: E,
  templates: readonly SchedulePresetLike[],
): TeamEntryView<E> {
  const template = templateFor(shift, templates);
  // A cell the import could not read keeps its own grey «?» square and says so in
  // words — «Смена» would claim we know what it is, and we do not.
  if (shift.unrecognisedCode) {
    return { shift, title: `Не распознано: «${shift.unrecognisedCode}»`, palette: UNRECOGNISED_SCHEDULE_PALETTE };
  }
  return {
    shift,
    // Отличие от копии в мини-аппе: подпись категории берётся из categoryLabel,
    // а не из третьей копии той же таблицы.
    title: template?.name ?? shift.title ?? categoryLabel(shift.category),
    palette: exactSchedulePalette(template?.accent, shift.category),
  };
}

export function compareShifts<E extends ScheduleEntryLike>(
  a: E,
  b: E,
  templates: readonly SchedulePresetLike[],
): number {
  const byStart = (a.start ?? "99:99").localeCompare(b.start ?? "99:99");
  if (byStart !== 0) return byStart;
  const aOrder = templateFor(a, templates)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const bOrder = templateFor(b, templates)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return toEntryView(a, templates).title.localeCompare(toEntryView(b, templates).title, "ru");
}

function weekCell<E extends ScheduleEntryLike>(
  date: string,
  employeeId: number | null,
  shifts: readonly E[],
  templates: readonly SchedulePresetLike[],
): WeekCell<E> {
  const entries = shifts
    .filter((shift) => shift.employeeId === employeeId && coversDate(shift, date))
    .sort((a, b) => compareShifts(a, b, templates))
    .map((shift) => toEntryView(shift, templates));
  return {
    date,
    entries,
    primary: entries[0] ?? null,
    extraCount: Math.max(0, entries.length - 1),
  };
}

export function buildWeekModel<E extends ScheduleEntryLike>(
  mondayIso: string,
  schedule: { employees: readonly TeamMemberLike[]; shifts: readonly E[] },
  templates: readonly SchedulePresetLike[],
): WeekModel<E> {
  // Отличие от копии в мини-аппе: дни считаются строковой арифметикой, а не
  // через `new Date(iso + "T12:00:00")`. Результат тот же, но на сервере в
  // расчёт не попадает часовой пояс машины.
  const days = Array.from({ length: 7 }, (_, index) => addDaysIso(mondayIso, index));
  const employees = [...schedule.employees].sort((a, b) => {
    const aOrder = a.rosterOrder ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.rosterOrder ?? Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder || a.id - b.id;
  });
  const rows: WeekRow<E>[] = employees.map((employee) => ({
    employeeId: employee.id,
    displayName: employee.displayName,
    cells: days.map((date) => weekCell(date, employee.id, schedule.shifts, templates)),
  }));
  if (
    schedule.shifts.some(
      (shift) => shift.employeeId == null && days.some((date) => coversDate(shift, date)),
    )
  ) {
    rows.push({
      employeeId: null,
      displayName: "Не назначено",
      cells: days.map((date) => weekCell(date, null, schedule.shifts, templates)),
    });
  }
  return { days, rows };
}

/** One entry in the week grid's key: the coloured square, and what it stands for. */
export interface WeekLegendItem {
  /** The letter drawn in the cell — «У», «Н», «ВА», «07», or «•» for a one-off. */
  code: string;
  /** What that letter means, in the preset's own words. */
  label: string;
  /** The preset's exact colours, or null when the cell falls back to its category's —
   *  those depend on the theme, so the consumer resolves them the same way the grid does. */
  palette: SchedulePalette | null;
  /** Only set alongside a null palette: which category's colour the cell used. */
  category: EntryCategory | null;
}

/** A one-off entry with no preset behind it; the grid draws it as a dot. */
const FALLBACK_LEGEND_CODE = "•";

/**
 * The key for a week grid, built from the week actually on screen rather than from
 * a fixed list of presets. A single letter in a coloured square is unguessable —
 * «П» is Поклонка and «Т» is Телефон, and nothing on the screen said so.
 *
 * Only the squares that are drawn count: a cell shows its primary entry and hides
 * the rest behind «+N», so listing those would explain colours nobody can see.
 * Names come from the entries themselves, so a renamed preset renames its own key
 * line, with no mapping here to drift out of date.
 *
 * Presetless entries all read «•» but are coloured by category, so they are keyed
 * per category — one line per distinct square, never one line for two colours.
 */
export function buildWeekLegend(model: WeekModel<ScheduleEntryLike>): WeekLegendItem[] {
  const seen = new Map<string, { item: WeekLegendItem; titles: Set<string> }>();
  for (const row of model.rows) {
    for (const cell of row.cells) {
      const entry = cell.primary;
      if (!entry) continue;
      const key = entry.palette ? entry.palette.code : `${FALLBACK_LEGEND_CODE}:${entry.shift.category}`;
      // Квадрат категории (отпуск, командировка, мероприятие) стоит за СОСТОЯНИЕ,
      // а не за заголовок конкретной записи: у разных людей заголовки разные, и
      // легенда склеивала их через « · » — строка росла, а объясняла хуже.
      // Заголовок записи никуда не девается, он виден в самой ячейке.
      // Сравнение по коду, а не по ссылке на объект: палитру по дороге могли
      // скопировать (тема, предпросмотр), и ссылочное равенство молча вернуло бы
      // заголовок записи вместо названия состояния.
      const categoryExact = exactSchedulePalette(undefined, entry.shift.category);
      const title = entry.palette && categoryExact && entry.palette.code === categoryExact.code
        ? categoryLabel(entry.shift.category)
        : entry.title;
      const existing = seen.get(key);
      if (existing) {
        existing.titles.add(title);
        continue;
      }
      seen.set(key, {
        item: {
          code: entry.palette?.code ?? FALLBACK_LEGEND_CODE,
          label: title,
          palette: entry.palette,
          category: entry.palette ? null : entry.shift.category,
        },
        titles: new Set([title]),
      });
    }
  }
  return [...seen.values()]
    .map(({ item, titles }) => ({ ...item, label: [...titles].sort((a, b) => a.localeCompare(b, "ru")).join(" · ") }))
    // The presetless ones are the catch-all, so they read last however the week is shaped.
    .sort(
      (a, b) =>
        (a.palette ? 0 : 1) - (b.palette ? 0 : 1) || a.label.localeCompare(b.label, "ru"),
    );
}
