/**
 * Куда открыть экран заказов по ссылке бота.
 *
 * Отдельный модуль, как `admin-section.ts`: App читает его до загрузки данных,
 * и тянуть ради одной функции весь экран в основной бандл незачем. Маршрут —
 * в query (`?screen=orders&order=12`), а не во фрагменте: фрагмент занят
 * `initData` Telegram.
 */
export type FoodRoute =
  | { view: "list" }
  | { view: "new-poll" }
  | { view: "new-order" }
  | { view: "order"; orderId: number }
  | { view: "places" };

export function foodRouteFromSearch(search: string): FoodRoute | null {
  const params = new URLSearchParams(search);
  if (params.get("screen") !== "orders") return null;
  const order = Number(params.get("order"));
  if (Number.isInteger(order) && order > 0) return { view: "order", orderId: order };
  const next = params.get("new");
  if (next === "poll") return { view: "new-poll" };
  if (next === "order") return { view: "new-order" };
  return { view: "list" };
}
