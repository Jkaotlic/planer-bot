import { dayOfWeek, isWeekend } from "./time";

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
  if (kind === "workday") return dayOfWeek(date) === 0 ? "💼 Рабочее воскресенье" : "💼 Рабочая суббота";
  return null;
}
