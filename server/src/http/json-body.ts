import type { Context } from "hono";

/**
 * Тело запроса, приведённое к объекту.
 *
 * `c.req.json()` парсит и `null`, и массив, и число без ошибки — `.catch`
 * ловит только неразобранный JSON. Без этой прослойки `{ choice?: ... }`,
 * навязанный кастом на голое `null`, падал бы на чтении `body.choice`
 * TypeError'ом (500), а не понятным 400. Общая для опросов, мест и заказов
 * еды — раньше жила тремя копиями и уже начала расходиться комментарием.
 */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const raw = await c.req.json().catch(() => null);
  return raw != null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}
