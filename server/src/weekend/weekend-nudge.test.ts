import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { eq } from "drizzle-orm";
import { shiftStartMs } from "@planer/shared";
import { shifts } from "../db/schema";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createVacantSlot, confirmAssignment, getAssignment, addInterest } from "../repo/weekend";
import { assignSlot, declineOffer } from "./weekend-service";
import { runWeekendNudgeTick } from "./weekend-nudge";
import type { Db } from "../db/client";

// Суббота 2026-10-03; «сегодня» — четверг 01.10, за два дня.
const SLOT_DATE = "2026-10-03";
const URL = "https://example.com";
const TZ = "Europe/Moscow";

/** Командные часы → абсолютный момент: тик получает и то и другое, и они обязаны совпадать. */
function momentOf(date: string, time: string): Date {
  return new Date(shiftStartMs({ date, start: time }, TZ));
}

/** Тик в командное «сейчас» с тем же моментом UTC, как его собрал бы index.ts. */
function tick(db: Db, b: Bot, date: string, time: string) {
  return runWeekendNudgeTick(db, b, { date, time }, URL, TZ, momentOf(date, time));
}

/**
 * `createdAt` записи ставит SQLite по своим часам — для теста время предложения
 * задаётся руками, иначе «прошла половина срока» зависела бы от дня прогона.
 */
function offeredAt(db: Db, assignmentId: number, at: Date) {
  const shiftId = getAssignment(db, assignmentId)!.shiftId!;
  db.update(shifts).set({ createdAt: at }).where(eq(shifts.id, shiftId)).run();
}

function bot() {
  const sent: { to: number; text: string; markup: string }[] = [];
  const b = {
    api: {
      sendMessage: vi.fn(async (to: number, text: string, extra?: { reply_markup?: unknown }) => {
        sent.push({ to, text, markup: JSON.stringify(extra?.reply_markup ?? null) });
      }),
    },
  };
  return { bot: b as unknown as Bot, sent };
}

function scene(db: Db) {
  const admin = createEmployee(db, { displayName: "Аня", inviteToken: "i-a", isAdmin: true });
  linkTelegramAccount(db, "i-a", 501);
  const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "i-i" });
  linkTelegramAccount(db, "i-i", 502);
  const slot = createVacantSlot(db, { date: SLOT_DATE, start: "10:00", end: "19:00" });
  addInterest(db, slot.id, igor.id);
  const res = assignSlot(db, slot.id, igor.id, "2026-09-28");
  if (!res.ok) throw new Error(String(res.reason));
  // Предложено в понедельник утром — половина срока до слота прошла в среду вечером.
  offeredAt(db, res.assignment.id, momentOf("2026-09-28", "10:00"));
  return { admin, igor, slot, assignmentId: res.assignment.id };
}

describe("тревога про выходной без ответа", () => {
  it("за два дня до слота, ответа нет — админам одно письмо с кнопкой графика", async () => {
    const db = makeTestDb();
    scene(db);
    const { bot: b, sent } = bot();

    await tick(db, b, "2026-10-01", "10:00");

    const toAdmin = sent.filter((m) => m.to === 501);
    expect(toAdmin).toHaveLength(1);
    expect(toAdmin[0]!.text).toContain("Игорь");
    expect(toAdmin[0]!.text).toContain("не ответил");
    expect(toAdmin[0]!.markup).toContain(`date=${SLOT_DATE}`);
    expect(sent.filter((m) => m.to === 502)).toHaveLength(0);
  });

  it("за три дня — рано", async () => {
    const db = makeTestDb();
    scene(db);
    const { bot: b, sent } = bot();
    await tick(db, b, "2026-09-30", "10:00");
    expect(sent).toHaveLength(0);
  });

  it("второй тик не повторяет", async () => {
    const db = makeTestDb();
    scene(db);
    const { bot: b, sent } = bot();
    await tick(db, b, "2026-10-01", "10:00");
    await tick(db, b, "2026-10-02", "10:00");
    expect(sent.filter((m) => m.to === 501)).toHaveLength(1);
  });

  it("ответил «выйду» — тревоги нет", async () => {
    const db = makeTestDb();
    const { assignmentId } = scene(db);
    confirmAssignment(db, assignmentId, getAssignment(db, assignmentId)!.shiftId!);
    const { bot: b, sent } = bot();
    await tick(db, b, "2026-10-01", "10:00");
    expect(sent).toHaveLength(0);
  });

  it("слот уже прошёл — молчит", async () => {
    const db = makeTestDb();
    scene(db);
    const { bot: b, sent } = bot();
    await tick(db, b, "2026-10-04", "10:00");
    expect(sent).toHaveLength(0);
  });

  it("сеть лежала — следующий тик пишет", async () => {
    const db = makeTestDb();
    scene(db);
    const down = { api: { sendMessage: vi.fn(async () => { throw new Error("network down"); }) } } as unknown as Bot;
    await tick(db, down, "2026-10-01", "10:00");
    const { bot: b, sent } = bot();
    await tick(db, b, "2026-10-01", "10:05");
    expect(sent.filter((m) => m.to === 501)).toHaveLength(1);
  });

  // H3: «не ответил(а)» должно быть правдой — у человека было время ответить.
  describe("ждёт половину срока между предложением и началом слота", () => {
    function lateScene(db: Db, offered: { date: string; time: string }) {
      const s = scene(db);
      offeredAt(db, s.assignmentId, momentOf(offered.date, offered.time));
      return s;
    }

    it("предложено за сутки — через 5 минут молчит, это не молчание человека", async () => {
      const db = makeTestDb();
      lateScene(db, { date: "2026-10-02", time: "10:00" });
      const { bot: b, sent } = bot();
      await tick(db, b, "2026-10-02", "10:05");
      expect(sent).toHaveLength(0);
    });

    it("предложено за сутки — за пять минут до половины срока ещё молчит", async () => {
      const db = makeTestDb();
      lateScene(db, { date: "2026-10-02", time: "10:00" });
      const { bot: b, sent } = bot();
      // Половина — 22:00 по Москве.
      await tick(db, b, "2026-10-02", "21:55");
      expect(sent).toHaveLength(0);
    });

    it("предложено за сутки — через 12 ч 5 мин одно письмо админу", async () => {
      const db = makeTestDb();
      lateScene(db, { date: "2026-10-02", time: "10:00" });
      const { bot: b, sent } = bot();
      // Слот, прочитанный как 10:00 UTC (13:00 по Москве), отодвинул бы половину
      // на 23:30, и письма здесь не было бы.
      await tick(db, b, "2026-10-02", "22:05");
      const toAdmin = sent.filter((m) => m.to === 501);
      expect(toAdmin).toHaveLength(1);
      expect(toAdmin[0]!.text).toContain("не ответил");
    });

    it("повторное предложение после отказа сбрасывает отсчёт", async () => {
      const db = makeTestDb();
      const { igor, slot, assignmentId } = lateScene(db, { date: "2026-10-01", time: "10:00" });
      expect(declineOffer(db, assignmentId, igor.id, "2026-10-02").ok).toBe(true);
      const again = assignSlot(db, slot.id, igor.id, "2026-10-02");
      if (!again.ok) throw new Error(String(again.reason));
      expect(again.assignment.id).toBe(assignmentId);
      offeredAt(db, assignmentId, momentOf("2026-10-02", "10:00"));
      const { bot: b, sent } = bot();
      // От первого предложения половина прошла ещё 01.10 в 22:00; от второго — нет.
      await tick(db, b, "2026-10-02", "10:05");
      expect(sent).toHaveLength(0);
      await tick(db, b, "2026-10-02", "22:05");
      expect(sent.filter((m) => m.to === 501)).toHaveLength(1);
    });

    it("предложено за пять дней — половина прошла раньше окна, тревога всё равно ждёт два дня", async () => {
      const db = makeTestDb();
      lateScene(db, { date: "2026-09-28", time: "10:00" });
      const { bot: b, sent } = bot();
      // Половина — 30.09 в 22:00; окно двух дней открывается 01.10.
      await tick(db, b, "2026-09-30", "22:05");
      expect(sent).toHaveLength(0);
      await tick(db, b, "2026-10-01", "00:05");
      expect(sent.filter((m) => m.to === 501)).toHaveLength(1);
    });
  });
});
