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
  return value === "announce" ? "announce" : null;
}
