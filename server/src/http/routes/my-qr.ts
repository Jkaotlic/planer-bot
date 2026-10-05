import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { GrammyError, InputFile, type Bot } from "grammy";
import { z } from "zod";
import { qrSavedStyleSchema, qrStyleSchema } from "@planer/shared";
import { QrTextError } from "@planer/shared/qr";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { getEmployeeById, setQrStyle } from "../../repo/employees";
import { renderQrPng } from "../../bot/qr-image";
import { safeErrorMessage } from "../../util/safe-error";
import { type Env, requireAuth } from "../middleware";

/**
 * One photo per person per five seconds. The API and the bot's long polling share one
 * process: a held-down button must not turn into a queue of uploads the whole team waits behind.
 */
export const QR_SEND_COOLDOWN_MS = 5_000;

/** A 1000-character text plus a style is ~3 KB of JSON; anything near 16 KB is not a QR request. */
const QR_BODY_MAX_BYTES = 16 * 1024;

const sendBody = z.object({ text: z.string(), style: qrStyleSchema }).strict();

/**
 * «QR-код» for the person holding the token: remember their style, send them the picture.
 * No employee id in the path — nobody can change or receive somebody else's.
 */
export function createMyQrRoutes(deps: { db: Db; config: Config; bot?: Bot; now?: () => number }): Hono<Env> {
  const { db, config, bot } = deps;
  const now = deps.now ?? Date.now;
  // Keyed by employee, not by IP: behind the KeenDNS relay every client shares one address
  // (see `rate-limit.ts`), so an IP limit would be one budget for the whole team. A team is
  // a few dozen people, so the map never needs sweeping.
  const lastSentAt = new Map<number, number>();
  const routes = new Hono<Env>();

  routes.put("/api/my/qr-style", requireAuth(db, config.jwtSecret), async (c) => {
    const parsed = qrSavedStyleSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Неизвестная форма или цвет QR-кода" }, 400);
    if (!setQrStyle(db, c.get("auth").employeeId, parsed.data)) return c.json({ error: "not_found" }, 404);
    return c.json({ qrStyle: parsed.data });
  });

  routes.post(
    "/api/my/qr",
    bodyLimit({ maxSize: QR_BODY_MAX_BYTES, onError: (c) => c.json({ error: "Слишком большой запрос" }, 413) }),
    requireAuth(db, config.jwtSecret),
    async (c) => {
      const parsed = sendBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Нужны текст и стиль QR-кода" }, 400);
      const { text, style } = parsed.data;
      if (!bot) return c.json({ error: "Бот сейчас не запущен — попробуй позже" }, 503);
      const id = c.get("auth").employeeId;
      const me = getEmployeeById(db, id);
      if (!me) return c.json({ error: "not_found" }, 404);
      if (me.telegramUserId == null) return c.json({ error: "Бот тебя не знает: открой его и нажми /start" }, 409);

      const t = now();
      const last = lastSentAt.get(id);
      if (last !== undefined && t - last < QR_SEND_COOLDOWN_MS) {
        c.header("Retry-After", String(Math.max(1, Math.ceil((QR_SEND_COOLDOWN_MS - (t - last)) / 1000))));
        return c.json({ error: "Не чаще раза в 5 секунд — подожди немного" }, 429);
      }

      let png: Buffer;
      try {
        png = renderQrPng(text, style);
      } catch (err) {
        // The person's own input: say what is wrong and leave the cooldown untouched.
        if (err instanceof QrTextError) return c.json({ error: err.message }, 400);
        throw err;
      }

      // Stamped before the await: a second tap while the upload is in flight is refused,
      // not queued behind it.
      lastSentAt.set(id, t);
      setQrStyle(db, id, style);
      try {
        await bot.api.sendPhoto(me.telegramUserId, new InputFile(png, "qr.png"), { caption: text });
      } catch (err) {
        // Nothing arrived, so a retry must not wait out the cooldown.
        lastSentAt.delete(id);
        console.error("qr: send failed:", safeErrorMessage(err));
        const blocked = err instanceof GrammyError && err.error_code === 403;
        return c.json(
          { error: blocked ? "Бот не может тебе написать — открой его и нажми /start" : "Не получилось отправить в бота — попробуй ещё раз" },
          502,
        );
      }
      return c.json({ ok: true });
    },
  );

  return routes;
}
