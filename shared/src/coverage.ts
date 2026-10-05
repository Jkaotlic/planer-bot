import { weekdayIndex, weekdayShort } from "./week-dates";
import { countsForBalance, type EntryCategory } from "./category";
import { formatDayMonth } from "./collection";
import { isDayOff, type DayCalendar } from "./calendar";

/**
 * Норма покрытия дня: сколько людей нужно на этом виде смены в каждый день недели.
 *
 * Хранится в базе строкой «3,2,2,2,2,0,0» (Пн..Вс) — колонка TEXT, на которой
 * SQLite ничего не стережёт. Поэтому разбор и запись всегда идут через эти
 * функции, а не через прямое `split(",")`.
 *
 * В shared, потому что читателей трое: сервер (пишет), консоль и мини-апп
 * (показывают норму и считают по ней нехватку дня). Посчитанное трижды однажды
 * разъедется.
 */

export class CoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoverageError";
  }
}

export const COVERAGE_DAYS = 7;

/**
 * "3,2,2,2,2,0,0" -> [3,2,2,2,2,0,0]. Exactly seven non-negative integers, Mon..Sun.
 * Throws with a Russian message naming what was wrong — this surfaces in the editor.
 */
export function parseCoverage(raw: string): number[] {
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.length !== COVERAGE_DAYS) {
    throw new CoverageError(`«Покрытие» должно содержать ровно ${COVERAGE_DAYS} чисел (Пн..Вс), а не ${parts.length}`);
  }
  return parts.map((part, index) => {
    // Number() would happily accept "", " ", "1e3", "0x2" and Infinity.
    if (!/^\d+$/.test(part)) {
      throw new CoverageError(`«Покрытие», день ${index + 1}: «${part}» — нужно целое число не меньше нуля`);
    }
    const value = Number(part);
    if (!Number.isSafeInteger(value)) {
      throw new CoverageError(`«Покрытие», день ${index + 1}: «${part}» — слишком большое число`);
    }
    return value;
  });
}

export function serializeCoverage(values: readonly number[]): string {
  if (values.length !== COVERAGE_DAYS) {
    throw new CoverageError(`«Покрытие» должно содержать ровно ${COVERAGE_DAYS} чисел (Пн..Вс), а не ${values.length}`);
  }
  for (const [index, value] of values.entries()) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new CoverageError(`«Покрытие», день ${index + 1}: ${value} — нужно целое число не меньше нуля`);
    }
  }
  return values.join(",");
}


/** Минимум, который расчёту нужен от вида смены. */
export interface CoverageTemplate {
  templateId: number;
  name: string;
  /** Норма по дням недели, Пн..Вс. */
  coverage: readonly number[];
}

/** Минимум, который расчёту нужен от записи графика. */
export interface CoverageEntry {
  date: string;
  endDate?: string | null;
  employeeId: number | null;
  templateId: number | null;
}

/** Вид смены, которого в дне не хватает: сколько нужно и сколько есть. */
export interface MissingKind {
  templateId: number;
  name: string;
  need: number;
  have: number;
}

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

/**
 * Норма словами: «Пн 2 · Вт 2 · Ср 2 · Чт 2 · Пт 2».
 *
 * Дни с нулём не показываются: ноль — это «не считаем», и хвост «Сб 0 · Вс 0»
 * висел бы под каждым видом смены, ничего не сообщая.
 */
export function coverageSummary(coverage: readonly number[]): string {
  const parts = WEEKDAY_LABELS.flatMap((day, index) => ((coverage[index] ?? 0) > 0 ? [`${day} ${coverage[index]}`] : []));
  return parts.length === 0 ? "норма не задана" : parts.join(" · ");
}

const SUNDAY_INDEX = 6;
const FRIDAY_NORM_INDEX = 4;

/**
 * По какой колонке нормы считать день. Четыре случая:
 *
 * - праздник в будни (Пн–Пт) — колонка воскресенья: обычные смены не нужны,
 *   дежурство выходного дня нужно;
 * - праздник в субботу или воскресенье — колонка СВОЕГО дня: решение владельца
 *   говорит о празднике, выпавшем на будний день, и выходной, совпавший с
 *   праздником, остаётся собой (норма субботы не превращается в норму воскресенья);
 * - рабочая суббота/воскресенье по переносу — колонка пятницы: это рабочий день
 *   перед выходным;
 * - рабочий день в будни (праздник, возвращённый в работу вручную) — свой день
 *   недели: понедельник остаётся понедельником, пятничная норма ему не родня;
 * - всё остальное — свой день недели.
 *
 * Решение владельца от 02.10.2026; до него праздник в среду требовал людей по
 * норме среды, и плашка с вечерним советом звали закрывать день, в который
 * никто не выходит.
 */
export function normWeekday(date: string, calendar: DayCalendar): number {
  const kind = calendar.get(date);
  const own = weekdayIndex(date);
  const weekend = own >= 5;
  if (kind === "holiday" && !weekend) return SUNDAY_INDEX;
  if (kind === "workday" && weekend) return FRIDAY_NORM_INDEX;
  return own;
}

/**
 * Чего в дне не хватает против нормы.
 *
 * Вид смены с нулевой нормой в ответе не участвует вовсе: ноль означает «не
 * считаем», а не «не хватает всех». Иначе первый же день после выкатки встретил
 * бы админа списком из девяти строк про виды, нормы которым никто не задавал.
 *
 * Норму закрывает ЧЕЛОВЕК, а не строка в сетке: у записи без `employeeId` некому
 * выйти. Люди считаются множеством — две записи одного вида на одного человека
 * это один вышедший, а не два.
 *
 * Календарь обязателен, без умолчания (как у `isDayOff`): забытый аргумент
 * молча вернул бы норму по дню недели, и праздник снова звал бы закрывать смены.
 */
export function missingCoverage(
  entries: readonly CoverageEntry[],
  templates: readonly CoverageTemplate[],
  date: string,
  calendar: DayCalendar,
): MissingKind[] {
  const weekday = normWeekday(date, calendar);
  const out: MissingKind[] = [];
  for (const template of templates) {
    const need = template.coverage[weekday] ?? 0;
    if (need === 0) continue;
    const people = new Set<number>();
    for (const entry of entries) {
      if (entry.templateId !== template.templateId || entry.employeeId == null) continue;
      // Тот же охват, что у чек-листов: многодневная запись покрывает каждый свой
      // день, а не только первый.
      if (entry.date > date || (entry.endDate ?? entry.date) < date) continue;
      people.add(entry.employeeId);
    }
    if (people.size < need) out.push({ templateId: template.templateId, name: template.name, need, have: people.size });
  }
  return out;
}

/**
 * «Не хватает: Утро — 1» — строка над днём.
 *
 * Разница, а не норма: админ читает это, глядя на день, где часть смен уже
 * стоит, и «Утро — 2» при одном поставленном сбивало бы с толку.
 */
export function coverageHint(missing: readonly MissingKind[]): string | null {
  if (missing.length === 0) return null;
  return `Не хватает: ${missingList(missing)}`;
}

/**
 * Что писать на кнопке дня в плашке нехватки: «Утро −1, День −2» либо, когда
 * видов больше двух, только итог дня — «−35».
 *
 * Перечень видов у тяжёлой недели (7 дней × 4 вида) растягивал плашку до 440px —
 * 52% экрана 844px, и полоска дней уезжала под таб-бар. Разбивка по видам
 * никуда не пропадает: она в подсказке дня, куда кнопка ведёт.
 */
export function dayShortfallText(missing: readonly MissingKind[]): string {
  if (missing.length === 0) return "";
  if (missing.length > 2) return `−${missing.reduce((sum, kind) => sum + (kind.need - kind.have), 0)}`;
  return missing.map((kind) => `${kind.name} −${kind.need - kind.have}`).join(", ");
}

/**
 * Строка плашки, когда ближайшая нехватка лежит за пределами показанной недели:
 * метка на вкладке считает «сегодня + 6 дней» и пересекает границу недели, а
 * плашка видит только свою неделю — без этой строки красное число вело бы к
 * зелёному «Нормы закрыты ✓». Число месяца без названия месяца: дата в пределах
 * ближайших шести дней однозначна.
 */
export function nearestShortfallLabel(date: string): string {
  return `Ближайшая нехватка: ${weekdayShort(date)} ${Number(date.slice(8, 10))} — показать →`;
}

/** Подсказка у редакторов нормы: правило календаря невидимо, пока не наступит праздник. */
export const NORM_CALENDAR_HINT = "В праздник в будни действует норма воскресенья, в рабочую субботу — норма пятницы.";

/** «Утро — 1, Дежурство — 2» — общий хвост подсказки дня и вечернего совета. */
function missingList(missing: readonly MissingKind[]): string {
  return missing.map((kind) => `${kind.name} — ${kind.need - kind.have}`).join(", ");
}

/** Запись графика, о которой совет может сказать «день пуст»: нужна категория. */
export interface GapEntry extends CoverageEntry {
  category: EntryCategory;
}

/** День, где график расходится с нормой или пуст вовсе. */
export interface DayGap {
  date: string;
  missing: MissingKind[];
  /** Ни одной рабочей записи с человеком — «смен нет», независимо от норм. */
  empty: boolean;
}

/**
 * Пробелы графика на заданные дни — материал для вечернего совета админам.
 *
 * Две проверки, а не одна, потому что норма дня в проде у всех видов смен
 * нулевая: совет, построенный только на `missingCoverage`, молчал бы ровно до
 * того дня, когда админ соберётся её задать. «Смен нет» видно и без норм.
 *
 * Пустота считается по рабочим записям с человеком (`countsForBalance`):
 * отпуск на весь отдел день не заполняет, и строка без `employeeId` — тоже.
 * Выходной по календарю пустым не бывает: команда в выходные и праздники не
 * работает, а выходная смена — отдельный поток со своими объявлениями. Нормы
 * при этом на выходные смотрят как обычно: ненулевая норма на субботу — решение
 * админа.
 */
export function scheduleGaps(
  entries: readonly GapEntry[],
  templates: readonly CoverageTemplate[],
  dates: readonly string[],
  calendar: DayCalendar,
): DayGap[] {
  const out: DayGap[] = [];
  for (const date of dates) {
    const missing = missingCoverage(entries, templates, date, calendar);
    // По календарю, а не по дню недели: в праздник не выходят, и пустой он
    // по праву; рабочая суббота, в которую никто не вышел, — пробел.
    const dayOff = isDayOff(date, calendar);
    const worked = entries.some(
      (entry) =>
        entry.employeeId != null &&
        countsForBalance(entry.category) &&
        entry.date <= date &&
        (entry.endDate ?? entry.date) >= date,
    );
    const empty = !dayOff && !worked;
    if (empty || missing.length > 0) out.push({ date, missing, empty });
  }
  return out;
}

/**
 * Текст совета, или `null`, когда сказать нечего.
 *
 * Пустой день перекрывает норму: «смен нет» уже говорит всё, и перечень
 * недостающих видов под ним был бы тем же самым другими словами. Подпись
 * «совет» — намеренно: письмо не требует действия, и день, оставленный
 * пустым нарочно, не должен читаться как ошибка.
 */
export function coverageAdviceText(gaps: readonly DayGap[]): string | null {
  if (gaps.length === 0) return null;
  const lines = gaps.map((gap) => {
    const label = `${weekdayShort(gap.date)} ${formatDayMonth(gap.date)}`;
    return gap.empty ? `${label} — смен нет` : `${label} — не хватает: ${missingList(gap.missing)}`;
  });
  return [
    "💡 Совет: в графике на неделю вперёд есть пробелы.",
    ...lines,
    "",
    "Если так и задумано — просто пропусти.",
  ].join("\n");
}

/** Вид смены для сводки недели: к норме добавлено то, по чему видно, нужна ли она. */
export interface NormTemplate extends CoverageTemplate {
  category: EntryCategory;
  fillMode?: "count" | "remainder";
}

/** День недели, в котором не хватает людей. */
export interface ShortDay {
  date: string;
  missing: MissingKind[];
  /** Сколько людей не хватает в этом дне по всем видам вместе. */
  short: number;
}

export interface WeekShortfall {
  /** Только дни с нехваткой: закрытая неделя — пустой список, и экран молчит. */
  days: ShortDay[];
  /** Людей, а не дней: «не хватает 4» — это сколько ещё надо поставить. */
  total: number;
  /** Смены и дежурства без нормы — по ним нехватку посчитать не из чего. */
  withoutNorm: { templateId: number; name: string }[];
}

/**
 * Нехватка недели одним ответом — для метки дня, строки над сеткой и точек на
 * полоске дней в мини-аппе.
 *
 * Отдельно от `scheduleGaps`: тот про вечерний совет и знает «день пуст», а
 * экрану графика пустой день и так виден. Здесь только счёт против нормы.
 *
 * `withoutNorm` существует, потому что нулевая норма молчит: вид, которому её
 * не задали, выглядит в сетке так же, как закрытый. Нормы ждём только от смен
 * и дежурств — у отпуска её нет по смыслу, как и у вида «все оставшиеся».
 */
export function weekShortfall(
  entries: readonly CoverageEntry[],
  templates: readonly NormTemplate[],
  dates: readonly string[],
  calendar: DayCalendar,
): WeekShortfall {
  const days: ShortDay[] = [];
  for (const date of dates) {
    const missing = missingCoverage(entries, templates, date, calendar);
    if (missing.length === 0) continue;
    days.push({ date, missing, short: missing.reduce((sum, kind) => sum + kind.need - kind.have, 0) });
  }
  const withoutNorm = templates
    .filter(
      (template) =>
        (template.category === "shift" || template.category === "duty") &&
        template.fillMode !== "remainder" &&
        template.coverage.every((need) => need === 0),
    )
    .map((template) => ({ templateId: template.templateId, name: template.name }));
  return { days, total: days.reduce((sum, day) => sum + day.short, 0), withoutNorm };
}

export type ShortfallState = "closed" | "short" | "no-norms";

export interface ShortfallStatus {
  state: ShortfallState;
  /** Сколько видов смен и дежурств без нормы — хвост «без нормы: N» в плашке. */
  unsetCount: number;
}

/** Ответ `GET /api/admin/shortfall` — нехватка на 7 дней от командной даты. */
export interface AdminShortfall {
  total: number;
  /** Первый день с дырой; `null`, когда дыр нет. */
  firstDate: string | null;
}

/**
 * Что показывать плашкой над графиком.
 *
 * Отдельная функция, а не условие на каждом экране: «закрыто» и «нормы не
 * заданы» выглядят в `weekShortfall` одинаково (дней с нехваткой нет), и одна
 * из морд рано или поздно показала бы зелёное там, где считать было не из чего.
 */
export function shortfallStatus(week: WeekShortfall, templates: readonly NormTemplate[]): ShortfallStatus {
  const unsetCount = week.withoutNorm.length;
  if (week.days.length > 0) return { state: "short", unsetCount };
  const withNorm = templates.filter(
    (template) =>
      (template.category === "shift" || template.category === "duty") &&
      template.fillMode !== "remainder" &&
      template.coverage.some((need) => need > 0),
  ).length;
  return { state: withNorm === 0 ? "no-norms" : "closed", unsetCount };
}
