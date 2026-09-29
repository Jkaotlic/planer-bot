import { Hono } from "hono";
import type { Bot } from "grammy";
import { z } from "zod";
import {
  FOOD_NOTE_MAX, FOOD_QTY_MAX, closesAtFromTime, isFutureClose, orderItemInputSchema, orderTotal, teamAudienceSchema, timeStr,
} from "@planer/shared";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { recordAudit } from "../../repo/audit";
import { resolveAudience } from "../../team/audience";
import { teamNow } from "../../util/team-time";
import { requireAuth, type Env } from "../middleware";
import { jsonBody } from "../json-body";
import { getPlaceView } from "../../orders/place-service";
import {
  addCustomItem, addMenuItem, cancelOrder, closeOrder, createOrder, declineOrder, getOrder, itemsOf, listOrdersFor,
  orderView, removeItem, setItemQty,
} from "../../orders/order-service";
import { finishOrderMessages, sendOrderInvites } from "../../orders/order-messenger";

const optionalText = z.string().trim().max(FOOD_NOTE_MAX).nullable().transform((s) => (s ? s : null));
const createSchema = z.object({
  placeId: z.number().int().positive().nullable(),
  note: optionalText,
  payHint: optionalText,
  closesTime: timeStr.nullable(),
  audience: teamAudienceSchema,
}).strict();

/**
 * Заказ еды. Запускает любой работник, деньги сдают ему — так он решил
 * (2026-09-29). Видимость и права — в сервисе; здесь коды: «не видишь» — 404,
 * «видишь, но нельзя» — 409 с причиной.
 */
export function createOrderRoutes(deps: { db: Db; config: Config; bot?: Bot }): Hono<Env> {
  const { db, config, bot } = deps;
  const app = new Hono<Env>();
  const auth = requireAuth(db, config.jwtSecret);
  const viewerOf = (c: { get(k: "auth"): { employeeId: number; isAdmin: boolean } }) => ({ id: c.get("auth").employeeId, isAdmin: c.get("auth").isAdmin });

  /** Заказ, который смотрящий вправе видеть, — или null (→ 404). */
  function visible(c: Parameters<typeof viewerOf>[0] & { req: { param(k: string): string } }) {
    const order = getOrder(db, Number(c.req.param("id")));
    const viewer = viewerOf(c);
    const now = teamNow(config.teamTz);
    return order && orderView(db, order, viewer, now) ? { order, viewer, now } : null;
  }

  app.get("/api/orders", auth, (c) => c.json({ orders: listOrdersFor(db, viewerOf(c), teamNow(config.teamTz)) }));

  app.post("/api/orders", auth, async (c) => {
    const parsed = createSchema.safeParse(await jsonBody(c));
    if (!parsed.success) return c.json({ error: "Проверь место, время и адресатов.", issues: parsed.error.issues }, 400);
    const now = teamNow(config.teamTz);
    const closesAt = closesAtFromTime(parsed.data.closesTime, now.date);
    // Срок в прошлом рождает заказ уже закрытым: письма уйдут с погашенными
    // кнопками, а тап откажет «Приём закрыт» — человек так и не поймёт, что
    // заказ вообще был его. Проверка — до отправки, той же строкой, что у
    // опросов (`isFutureClose`).
    if (!isFutureClose(closesAt, now)) return c.json({ error: "Время уже прошло — поставь позже или оставь пустым." }, 400);
    if (!bot) return c.json({ error: "Бот не запущен — рассылка недоступна" }, 503);
    const viewer = viewerOf(c);
    const place = parsed.data.placeId == null ? null : getPlaceView(db, parsed.data.placeId);
    if (parsed.data.placeId != null && !place) return c.json({ error: "Такого места больше нет." }, 409);
    const { reachable, unreachable } = resolveAudience(db, parsed.data.audience, viewer.id, now.date);
    if (reachable.length < 2) return c.json({ error: "Некому отправить: в списке никого, кроме тебя." }, 409);
    const order = createOrder(db, {
      createdBy: viewer.id, placeId: parsed.data.placeId, note: parsed.data.note, payHint: parsed.data.payHint,
      closesAt, recipientIds: reachable.map((e) => e.id),
    });
    const delivered = await sendOrderInvites(bot, db, order, now, config.publicUrl);
    recordAudit(db, "order_created", viewer.id, { orderId: order.id, placeName: place?.name ?? null, recipients: reachable.length, delivered });
    return c.json({ order: orderView(db, order, viewer, now), delivered, unreachable }, 201);
  });

  app.get("/api/orders/:id", auth, (c) => {
    const v = visible(c);
    return v ? c.json({ order: orderView(db, v.order, v.viewer, v.now) }) : c.json({ error: "not_found" }, 404);
  });

  app.post("/api/orders/:id/items", auth, async (c) => {
    const v = visible(c);
    if (!v) return c.json({ error: "not_found" }, 404);
    const parsed = orderItemInputSchema.safeParse(await jsonBody(c));
    if (!parsed.success) return c.json({ error: "Проверь блюдо и цену (целые рубли, до 100 000).", issues: parsed.error.issues }, 400);
    const input = parsed.data;
    const result = "menuItemId" in input
      ? addMenuItem(db, v.order, v.viewer.id, input.menuItemId, v.now)
      : addCustomItem(db, v.order, v.viewer.id, input, v.now);
    if (!result.ok) return c.json({ error: result.error }, 409);
    return c.json({ order: orderView(db, v.order, v.viewer, v.now) });
  });

  app.patch("/api/orders/:id/items/:itemId", auth, async (c) => {
    const v = visible(c);
    if (!v) return c.json({ error: "not_found" }, 404);
    const body = (await jsonBody(c)) as { qty?: unknown };
    if (!Number.isInteger(body.qty) || (body.qty as number) < 1 || (body.qty as number) > FOOD_QTY_MAX) {
      return c.json({ error: `Количество — от 1 до ${FOOD_QTY_MAX}.` }, 400);
    }
    const result = setItemQty(db, v.order, v.viewer.id, Number(c.req.param("itemId")), body.qty as number, v.now);
    if (!result.ok) return c.json({ error: result.error }, 409);
    return c.json({ order: orderView(db, v.order, v.viewer, v.now) });
  });

  app.delete("/api/orders/:id/items/:itemId", auth, (c) => {
    const v = visible(c);
    if (!v) return c.json({ error: "not_found" }, 404);
    const result = removeItem(db, v.order, v.viewer.id, Number(c.req.param("itemId")), v.now);
    if (!result.ok) return c.json({ error: result.error }, 409);
    return c.json({ order: orderView(db, v.order, v.viewer, v.now) });
  });

  app.post("/api/orders/:id/decline", auth, (c) => {
    const v = visible(c);
    if (!v) return c.json({ error: "not_found" }, 404);
    const result = declineOrder(db, v.order, v.viewer.id, v.now);
    if (!result.ok) return c.json({ error: result.error }, 409);
    return c.json({ order: orderView(db, v.order, v.viewer, v.now) });
  });

  for (const action of ["close", "cancel"] as const) {
    app.post(`/api/orders/:id/${action}`, auth, async (c) => {
      const v = visible(c);
      if (!v) return c.json({ error: "not_found" }, 404);
      const result = action === "close" ? closeOrder(db, v.order, v.viewer) : cancelOrder(db, v.order, v.viewer);
      if (!result.ok) return c.json({ error: result.error }, 409);
      const fresh = getOrder(db, v.order.id)!;
      recordAudit(db, action === "close" ? "order_closed" : "order_cancelled", v.viewer.id, {
        orderId: fresh.id, placeName: getPlaceView(db, fresh.placeId ?? 0)?.name ?? null, total: orderTotal(itemsOf(db, fresh.id)),
      });
      if (bot) await finishOrderMessages(bot, db, fresh, action === "close" ? "closed" : "cancelled", config.publicUrl);
      return c.json({ order: orderView(db, fresh, v.viewer, v.now) });
    });
  }

  return app;
}
