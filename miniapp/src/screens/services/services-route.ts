/**
 * Ссылка бота «🧰 Открыть Сервисы» (`?screen=services`).
 *
 * Отдельный модуль, как `food-route.ts`: App читает его до загрузки данных.
 * Маршрут — в query, а не во фрагменте: фрагмент занят `initData` Telegram.
 */
export function servicesFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("screen") === "services";
}
