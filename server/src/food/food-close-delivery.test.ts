import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { silentBot } from "../bot/testbot";
import type { Db } from "../db/client";
import { employees } from "../db/schema";
import { makeTestDb } from "../db/testdb";
import { addCustomItem, createOrder, getOrder } from "../orders/order-service";
import { setOrderPaid } from "../orders/order-payment-service";
import { createPoll, getPoll } from "../polls/poll-service";
import { listRecentAudit } from "../repo/audit";
import { archiveEmployee, createEmployee, linkTelegramAccount, restoreEmployee } from "../repo/employees";
import { closeOrderWithMessages, closePollWithMessages } from "./food-close";
import { deliverFoodCloseMessages } from "./food-close-delivery";

function person(db: Db, displayName: string, telegramId: number) {
  const inviteToken = `inv-${telegramId}`;
  const employee = createEmployee(db, { displayName, inviteToken });
  linkTelegramAccount(db, inviteToken, telegramId);
  return { id: employee.id, isAdmin: false };
}

function stagePoll() {
  const db = makeTestDb();
  const anya = person(db, "Аня", 100);
  const igor = person(db, "Игорь", 200);
  const mark = person(db, "Марк", 300);
  const poll = createPoll(db, { createdBy: anya.id, question: "Пицца?", closesAt: null, recipientIds: [anya.id, igor.id, mark.id] });
  return { db, poll, anya, igor, mark };
}

describe("доставка после закрытия", () => {
  it("откатывает закрытие и аудит, если не удалось сохранить задания на отправку", () => {
    const { db, poll, anya } = stagePoll();
    db.run(sql`CREATE TEMP TRIGGER fail_close_queue BEFORE INSERT ON food_close_messages
      BEGIN SELECT RAISE(ABORT, 'queue test failure'); END`);
    expect(() => closePollWithMessages(db, poll, anya, "closed")).toThrow();
    expect(getPoll(db, poll.id)?.closedAt).toBeNull();
    expect(listRecentAudit(db, 10).some(row => row.type === "poll_closed")).toBe(false);
  });

  it("перед отправкой проверяет, что адресат всё ещё в команде и его аккаунт не изменился", async () => {
    const { db, poll, anya, igor, mark } = stagePoll();
    expect(closePollWithMessages(db, poll, anya, "closed")).toEqual({ ok: true });
    archiveEmployee(db, igor.id, "2026-09-29");
    db.update(employees).set({ telegramUserId: 400 }).where(eq(employees.id, mark.id)).run();
    const { bot, recorder } = silentBot();
    await deliverFoodCloseMessages(db, bot);
    expect(recorder.sent.map(m => m.chat_id)).toEqual([100]);

    restoreEmployee(db, igor.id);
    db.update(employees).set({ telegramUserId: 300 }).where(eq(employees.id, mark.id)).run();
    await deliverFoodCloseMessages(db, bot);
    expect(recorder.sent.map(m => m.chat_id)).toEqual([100]);
  });

  it("одновременные отправки из тика и ручного закрытия не посылают одно письмо дважды", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    const poll = createPoll(db, { createdBy: anya.id, question: "Пицца?", closesAt: null, recipientIds: [anya.id] });
    expect(closePollWithMessages(db, poll, anya, "closed")).toEqual({ ok: true });
    const { bot, recorder } = silentBot();
    let started!: () => void;
    let release!: () => void;
    const sending = new Promise<void>((resolve) => { started = resolve; });
    const send = new Promise<void>((resolve) => { release = resolve; });
    bot.api.config.use(async (prev, method, payload, signal) => {
      if (method === "sendMessage") {
        started();
        await send;
      }
      return prev(method, payload, signal);
    });
    const manual = deliverFoodCloseMessages(db, bot, `poll:${poll.id}`);
    await sending;
    const tick = deliverFoodCloseMessages(db, bot);
    release();
    await Promise.all([manual, tick]);
    expect(recorder.sent.map(m => m.chat_id)).toEqual([100]);
  });

  it("не отправляет просьбу оплатить заказ, если получатель уже отметил оплату", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    const igor = person(db, "Игорь", 200);
    const order = createOrder(db, {
      createdBy: anya.id, placeId: null, title: null, allowCustom: true, note: null, payHint: null,
      closesAt: null, recipientIds: [anya.id, igor.id],
    });
    const now = { date: "2026-09-29", time: "12:00" };
    expect(addCustomItem(db, order, igor.id, { name: "Салат", price: 70, qty: 1 }, now).ok).toBe(true);
    expect(closeOrderWithMessages(db, order, anya, "closed")).toEqual({ ok: true });
    expect(setOrderPaid(db, getOrder(db, order.id)!, igor.id, igor, true).ok).toBe(true);
    const { bot, recorder } = silentBot();
    await deliverFoodCloseMessages(db, bot);
    expect(recorder.sent.map(m => m.chat_id)).toEqual([100]);
  });
});
