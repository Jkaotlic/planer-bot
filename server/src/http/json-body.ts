import type { Context } from "hono";

/**
 * Тело запроса, приведённое к объекту.
 *
 * `c.req.json()` парсит и `null`, и массив, и число без ошибки — `.catch`
 * ловит только неразобранный JSON. Без этой прослойки `{ choice?: ... }`,
 * навязанный кастом на голое `null`, падал бы на чтении `body.choice`
 * с TypeError (500). Пустой объект оставляет обработчику проверку обязательных
 * полей и его прежний текст ошибки.
 */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  return (await jsonObjectBody(c)) ?? {};
}

/**
 * Пустое и неразбираемое тело сохраняют прежние значения по умолчанию.
 * Приглашение и сбор могут создаваться без полей. Явный массив, скаляр или null
 * возвращаем как null, чтобы маршрут успел отказать до записи.
 */
export async function jsonObjectBody(c: Context): Promise<Record<string, unknown> | null> {
  const raw: unknown = await c.req.json().catch(() => ({}));
  return raw != null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}
