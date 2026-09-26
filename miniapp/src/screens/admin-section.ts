import { parseISODate, toISODate } from "@planer/shared";

/**
 * Разделы админской вкладки и разбор ссылки на них.
 *
 * Отдельным модулем, а не внутри `AdminScreen.tsx`, ровно по одной причине: сама
 * вкладка админа грузится отдельным куском (`lazy` в `App.tsx`), а этот разбор
 * нужен ПРИ СТАРТЕ — им решается, какую вкладку открыть. Статический импорт из
 * `AdminScreen.tsx` затянул бы в основной бандл все восемь админских экранов
 * вместе с ним, то есть отменил бы разделение.
 */
export type AdminSection =
  | "schedule"
  | "weekend"
  | "employees"
  | "checklists"
  | "announce"
  | "bugs"
  | "journal"
  | "settings";

/** Раздел, на котором открыться, если мини-апп запущен ссылкой из бота.
 *  Своя функция, а не `screenFromSearch`: та отвечает за формы-оверлеи
 *  (больничный, мероприятие), а это — про вкладку админа. Один параметр,
 *  но два разных вопроса к нему. */
export function adminSectionFromSearch(search: string): AdminSection | null {
  const value = new URLSearchParams(search).get("screen");
  return value === "announce" || value === "schedule" ? value : null;
}

/**
 * Дата из ссылки на график («📅 Открыть график» у админских тревог) — только
 * настоящая календарная дата. Неверная строка не бросает и не роняет прыжок на
 * дату — экран открывается как обычно, просто без него (её решение из
 * `admin-deeplink.test.ts`).
 *
 * `Date` у невозможной даты не бросает, а перекатывает («2026-13-40» → какой-то
 * день следующего года) — поэтому проверка через обратное преобразование, а не
 * через ручные границы месяца/дня.
 */
export function scheduleDateFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get("date");
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return toISODate(parseISODate(value)) === value ? value : null;
}
