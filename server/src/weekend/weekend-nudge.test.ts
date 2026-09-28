import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createVacantSlot, confirmAssignment, getAssignment, addInterest } from "../repo/weekend";
import { assignSlot } from "./weekend-service";
import { runWeekendNudgeTick } from "./weekend-nudge";
import type { Db } from "../db/client";

// Суббота 2026-10-03; «сегодня» — четверг 01.10, за два дня.
const SLOT_DATE = "2026-10-03";
const URL = "https://example.com";

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
  return { admin, igor, slot, assignmentId: res.assignment.id };
}

describe("тревога про выходной без ответа", () => {
  it("за два дня до слота, ответа нет — админам одно письмо с кнопкой графика", async () => {
    const db = makeTestDb();
    scene(db);
    const { bot: b, sent } = bot();

    await runWeekendNudgeTick(db, b, { date: "2026-10-01", time: "10:00" }, URL);

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
    await runWeekendNudgeTick(db, b, { date: "2026-09-30", time: "10:00" }, URL);
    expect(sent).toHaveLength(0);
  });

  it("второй тик не повторяет", async () => {
    const db = makeTestDb();
    scene(db);
    const { bot: b, sent } = bot();
    await runWeekendNudgeTick(db, b, { date: "2026-10-01", time: "10:00" }, URL);
    await runWeekendNudgeTick(db, b, { date: "2026-10-02", time: "10:00" }, URL);
    expect(sent.filter((m) => m.to === 501)).toHaveLength(1);
  });

  it("ответил «выйду» — тревоги нет", async () => {
    const db = makeTestDb();
    const { assignmentId } = scene(db);
    confirmAssignment(db, assignmentId, getAssignment(db, assignmentId)!.shiftId!);
    const { bot: b, sent } = bot();
    await runWeekendNudgeTick(db, b, { date: "2026-10-01", time: "10:00" }, URL);
    expect(sent).toHaveLength(0);
  });

  it("слот уже прошёл — молчит", async () => {
    const db = makeTestDb();
    scene(db);
    const { bot: b, sent } = bot();
    await runWeekendNudgeTick(db, b, { date: "2026-10-04", time: "10:00" }, URL);
    expect(sent).toHaveLength(0);
  });

  it("сеть лежала — следующий тик пишет", async () => {
    const db = makeTestDb();
    scene(db);
    const down = { api: { sendMessage: vi.fn(async () => { throw new Error("network down"); }) } } as unknown as Bot;
    await runWeekendNudgeTick(db, down, { date: "2026-10-01", time: "10:00" }, URL);
    const { bot: b, sent } = bot();
    await runWeekendNudgeTick(db, b, { date: "2026-10-01", time: "10:05" }, URL);
    expect(sent.filter((m) => m.to === 501)).toHaveLength(1);
  });
});
