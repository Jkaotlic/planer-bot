import { createHmac, timingSafeEqual } from "node:crypto";
import { URLSearchParams } from "node:url";

export interface TelegramUser {
  id: number;
  firstName?: string;
  lastName?: string;
  username?: string;
}

export interface ValidatedInitData {
  user: TelegramUser;
  authDate: number;
}

function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function secretKey(botToken: string): Buffer {
  return createHmac("sha256", "WebAppData").update(botToken).digest();
}

/** Build a signed initData query string. For tests and local tooling. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  params.delete("hash");
  const hash = createHmac("sha256", secretKey(botToken)).update(dataCheckString(params)).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

/**
 * Сколько живёт `initData` как пропуск.
 *
 * Было пять минут, и это ломало мини-апп наглухо. Клиент переспрашивает токен
 * ТЕМ ЖЕ `initData`, с которым открылся вебвью: SDK достаёт launch-параметры из
 * хеша URL, а если их там нет — из sessionStorage той же сессии, и `auth_date`
 * при этом не обновляется никогда. JWT живёт шесть часов, вебвью Telegram —
 * дольше пяти минут почти всегда. Значит любая переавторизация позже пятой
 * минуты не могла пройти в принципе: токен сброшен, взять новый неоткуда,
 * каждый следующий запрос — 401 и пустой экран.
 *
 * Сутки — столько же держат референсные реализации Telegram. Подлинность
 * доказывает подпись, а окно ограничивает лишь то, как долго можно переиграть
 * перехваченный `initData`; верхняя граница поэтому остаётся.
 */
export const INIT_DATA_MAX_AGE_SEC = 24 * 3600;

/** Validate Telegram Mini App initData. Throws Error on any failure. */
export function validateInitData(
  initData: string,
  botToken: string,
  opts: { maxAgeSec?: number; nowSec?: number } = {},
): ValidatedInitData {
  const maxAge = opts.maxAgeSec ?? INIT_DATA_MAX_AGE_SEC;
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("initData: missing hash");
  params.delete("hash");

  const expected = createHmac("sha256", secretKey(botToken)).update(dataCheckString(params)).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("initData: bad signature");

  const authDateRaw = params.get("auth_date");
  if (authDateRaw === null) throw new Error("initData: missing auth_date");
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate)) throw new Error("initData: invalid auth_date");
  if (nowSec - authDate > maxAge) throw new Error("initData: expired");

  const userRaw = params.get("user");
  if (!userRaw) throw new Error("initData: missing user");
  const u = JSON.parse(userRaw) as { id: number; first_name?: string; last_name?: string; username?: string };
  return {
    user: { id: u.id, firstName: u.first_name, lastName: u.last_name, username: u.username },
    authDate,
  };
}
