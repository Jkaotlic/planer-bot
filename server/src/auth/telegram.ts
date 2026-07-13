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

/** Validate Telegram Mini App initData. Throws Error on any failure. */
export function validateInitData(
  initData: string,
  botToken: string,
  opts: { maxAgeSec?: number; nowSec?: number } = {},
): ValidatedInitData {
  const maxAge = opts.maxAgeSec ?? 300;
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("initData: missing hash");
  params.delete("hash");

  const expected = createHmac("sha256", secretKey(botToken)).update(dataCheckString(params)).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("initData: bad signature");

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) throw new Error("initData: missing auth_date");
  if (nowSec - authDate > maxAge) throw new Error("initData: expired");

  const userRaw = params.get("user");
  if (!userRaw) throw new Error("initData: missing user");
  const u = JSON.parse(userRaw) as { id: number; first_name?: string; last_name?: string; username?: string };
  return {
    user: { id: u.id, firstName: u.first_name, lastName: u.last_name, username: u.username },
    authDate,
  };
}
