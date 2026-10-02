import { dayOfWeek, isWeekend } from "./time";
import { weekdayShort } from "./week-dates";

/**
 * Календарь дней: только исключения из правила «суббота и воскресенье — выходные».
 *
 * `holiday` — день отдыха в будни (государственный праздник или перенесённый
 * выходной), `workday` — рабочая суббота или воскресенье по переносу. Обычные
 * выходные в календаре не лежат: их считает `isDayOff`, и пустой календарь
 * означает ровно то поведение, что было до праздников.
 *
 * В shared, потому что читателей четверо: сервер (проверка записи, расстановка,
 * вакантные смены, картинка недели, совет о пробелах), мини-апп и консоль
 * (покраска дня, «заполнить неделю»). Посчитанное в каждом по-своему разъедется.
 */
export type DayKind = "holiday" | "workday";
export type DayCalendar = ReadonlyMap<string, DayKind>;

export const EMPTY_CALENDAR: DayCalendar = new Map();

export function calendarFrom(rows: readonly { date: string; kind: DayKind }[]): DayCalendar {
  return new Map(rows.map((row) => [row.date, row.kind]));
}

/** Выходной ли день: праздник — да, рабочая суббота — нет, иначе по дню недели. */
export function isDayOff(date: string, calendar: DayCalendar): boolean {
  const kind = calendar.get(date);
  if (kind === "holiday") return true;
  if (kind === "workday") return false;
  return isWeekend(date);
}

/**
 * Подпись дня для шапки графика, или `null` для обычного дня.
 *
 * Название — из источника («День России»); перенесённый выходной названия не
 * имеет, и «Выходной по календарю» честнее выдуманного. Рабочий выходной
 * называется по дню недели: «рабочая суббота» — устойчивое выражение, а
 * «рабочий выходной» читается как оксюморон.
 */
export function dayOffLabel(date: string, kind: DayKind | undefined, note: string | null): string | null {
  if (kind === "holiday") {
    const title = note?.trim();
    return title ? `🎉 ${title} — выходной` : "🎉 Выходной по календарю";
  }
  if (kind === "workday") {
    // Будень, возвращённый в работу: «рабочая суббота» на среде соврала бы, а подпись
    // нужна — редактор дня показывает по ней, что отметка стоит (и снимается).
    if (!isWeekend(date)) return "💼 Рабочий день";
    return dayOfWeek(date) === 0 ? "💼 Рабочее воскресенье" : "💼 Рабочая суббота";
  }
  return null;
}

/** Особый день для подписи человеку: `label` — строка под неделей, `short` — для узкой шапки колонки. */
export interface SpecialDay {
  date: string;
  kind: DayKind;
  label: string;
  short: string;
}

/**
 * Праздники и рабочие выходные из `dates`, с подписями, по порядку `dates`.
 *
 * Идём по списку дат, а не по строкам календаря: строк может быть на месяц, а
 * нужна одна неделя, и порядок задаёт экран, а не база. Название пишется
 * текстом на самом экране — подсказки по наведению на телефоне нет.
 */
export function specialDays(
  dates: readonly string[],
  rows: readonly { date: string; kind: DayKind; note?: string | null }[],
): SpecialDay[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const out: SpecialDay[] = [];
  for (const date of dates) {
    const row = byDate.get(date);
    if (!row) continue;
    const when = `${weekdayShort(date)} ${Number(date.slice(8, 10))}`;
    if (row.kind === "holiday") {
      const title = row.note?.trim();
      out.push({
        date,
        kind: "holiday",
        label: `🎉 ${when} — ${title || "выходной по календарю"}`,
        short: `🎉 ${title || "выходной"}`,
      });
    } else {
      // Будень, возвращённый в работу, — обычный день; особым он был бы только для нормы.
      if (!isWeekend(date)) continue;
      const name = dayOfWeek(date) === 0 ? "рабочее воскресенье" : "рабочая суббота";
      out.push({ date, kind: "workday", label: `💼 ${when} — ${name}`, short: "💼 рабочая" });
    }
  }
  return out;
}
