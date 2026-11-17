import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { openDb, runMigrations } from "../db/client";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { recordApi, silentBot } from "../bot/testbot";
import { createPoll, getPoll } from "../polls/poll-service";
import { createOrder, getOrder } from "../orders/order-service";
import { listRecentAudit } from "../repo/audit";
import { runFoodTick } from "./food-tick";

describe("runFoodTick", () => {
  it("досылает закрытые опрос и заказ после сбоя без повторов уже доставленного", async () => {
    const path = mkdtempSync(join(tmpdir(), "planer-food-delivery-"));
    const databaseUrl = join(path, "test.db");
    const original = openDb(databaseUrl);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-29T09:00:00Z"));
      const { db, sqlite } = original;
      runMigrations(db, sqlite);
      const anya = createEmployee(db, { displayName: "Аня", inviteToken: "inv-a" });
      const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-i" });
      linkTelegramAccount(db, "inv-a", 100);
      linkTelegramAccount(db, "inv-i", 200);
      const closesAt = "2026-09-29T11:00";
      createPoll(db, { createdBy: anya.id, question: "Пицца?", closesAt, recipientIds: [anya.id, igor.id] });
      createOrder(db, { createdBy: igor.id, placeId: null, title: null, allowCustom: true, note: null, payHint: null, closesAt, recipientIds: [igor.id] });

      const first = silentBot();
      first.bot.api.config.use(async (prev, method, payload, signal) => {
        if (method === "sendMessage" && (payload as { chat_id: number }).chat_id === 200) throw new Error("ECONNRESET");
        return prev(method, payload, signal);
      });
      expect(await runFoodTick(db, first.bot, { date: "2026-09-29", time: "12:00" })).toBe(2);
      expect(first.recorder.sent.map(m => m.chat_id)).toEqual([100]);

      // Перезапуск не знает результатов предыдущей отправки вне SQLite.
      sqlite.close();
      vi.setSystemTime(new Date("2026-09-29T09:05:01Z"));
      const reopened = openDb(databaseUrl);
      const resumed = silentBot();
      try {
        expect(await runFoodTick(reopened.db, resumed.bot, { date: "2026-09-29", time: "12:05" })).toBe(0);
        expect(resumed.recorder.sent.map(m => m.chat_id)).toEqual([200, 200]);
        expect(resumed.recorder.sent[0]?.text).toContain("Итоги опроса");
        expect(resumed.recorder.sent[1]?.text).toContain("закрыт");
        vi.setSystemTime(new Date("2026-09-29T09:10:01Z"));
        await runFoodTick(reopened.db, resumed.bot, { date: "2026-09-29", time: "12:10" });
        expect(resumed.recorder.sent).toHaveLength(2);
      } finally {
        reopened.sqlite.close();
      }
    } finally {
      vi.useRealTimers();
      if (original.sqlite.open) original.sqlite.close();
      rmSync(path, { recursive: true, force: true });
    }
  });

  it("закрывает просроченный опрос один раз и рассылает итог один раз", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "inv-a" });
    linkTelegramAccount(db, "inv-a", 100);
    const poll = createPoll(db, { createdBy: anya.id, question: "Пицца?", closesAt: "2026-09-29T11:00", recipientIds: [anya.id] });
    const { bot } = silentBot();
    const api = recordApi(bot);
    const now = { date: "2026-09-29", time: "12:00" };
    expect(await runFoodTick(db, bot, now)).toBe(1);
    expect(await runFoodTick(db, bot, now)).toBe(0);
    expect(getPoll(db, poll.id)!.closedAt).not.toBeNull();
    expect(api.sent.filter((m) => m.text.includes("Итоги опроса"))).toHaveLength(1);
  });

  it("закрывает просроченный заказ один раз: одна сводка запускающему", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "inv-a" });
    linkTelegramAccount(db, "inv-a", 100);
    const order = createOrder(db, { createdBy: anya.id, placeId: null, title: null, allowCustom: true, note: null, payHint: null, closesAt: "2026-09-29T11:00", recipientIds: [anya.id] });
    const { bot } = silentBot();
    const api = recordApi(bot);
    const now = { date: "2026-09-29", time: "12:00" };
    expect(await runFoodTick(db, bot, now)).toBe(1);
    expect(await runFoodTick(db, bot, now)).toBe(0);
    expect(getOrder(db, order.id)!.closedAt).not.toBeNull();
    expect(api.sent.filter((m) => m.text.includes("закрыт"))).toHaveLength(1);
    // Тик закрывает без актора — это его собственное действие, не человека,
    // и `byTick` отличает автоматическое закрытие от ручного в той же ленте.
    const entries = listRecentAudit(db, 10).filter((row) => row.type === "order_closed");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorEmployeeId).toBeNull();
    expect(entries[0]!.payload).toMatchObject({ orderId: order.id, byTick: true });
  });

  it("заказ со сроком на завтра не закрывается сегодняшним тиком, а завтра — ровно одной сводкой", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "inv-a" });
    linkTelegramAccount(db, "inv-a", 100);
    const order = createOrder(db, { createdBy: anya.id, placeId: null, title: "Икра", allowCustom: true, note: null, payHint: null, closesAt: "2026-09-30T10:00", recipientIds: [anya.id] });
    const { bot } = silentBot();
    const api = recordApi(bot);
    expect(await runFoodTick(db, bot, { date: "2026-09-29", time: "23:59" })).toBe(0);
    expect(getOrder(db, order.id)!.closedAt).toBeNull();
    expect(api.sent).toHaveLength(0);
    expect(await runFoodTick(db, bot, { date: "2026-09-30", time: "10:00" })).toBe(1);
    expect(await runFoodTick(db, bot, { date: "2026-09-30", time: "10:01" })).toBe(0);
    expect(api.sent.filter((m) => m.text.includes("закрыт"))).toHaveLength(1);
  });
});
