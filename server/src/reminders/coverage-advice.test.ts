import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { recordApi, stubBotInfo } from "../bot/testbot";
import { makeTestDb } from "../db/testdb";
import { shiftTemplates } from "../db/schema";
import { createEmployee, linkTelegramAccount, setEmployeeAdmin } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { listRecentAudit } from "../repo/audit";
import { setNoticeMuted } from "../repo/notice-prefs";
import { setCoverage } from "../repo/templates";
import { runCoverageAdviceTick } from "./coverage-advice";
import type { Db } from "../db/client";

/**
 * Вечерний совет админам: где на неделе вперёд график пуст или ниже нормы.
 *
 * Совет, а не тревога: одно письмо в день, только когда есть что сказать, и
 * его можно выключить как любой вид админских уведомлений.
 */

/** Пятница; неделя вперёд — сб 05.09 … пт 11.09, будни — пн 07.09 … пт 11.09. */
const TODAY = "2026-09-04";
const EVENING = { date: TODAY, time: "20:05" };
const WEEKDAYS = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"];

function testBot() {
  const bot = stubBotInfo(new Bot("12345:tok"), { id: 42, first_name: "P", username: "p_bot" });
  const { sent } = recordApi(bot);
  return { bot, sent };
}

function stage() {
  const db: Db = makeTestDb();
  const admin = createEmployee(db, { displayName: "Аня", inviteToken: "inv-111" });
  linkTelegramAccount(db, "inv-111", 111);
  setEmployeeAdmin(db, admin.id, true);
  const worker = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-333" });
  linkTelegramAccount(db, "inv-333", 333);
  return { db, admin, worker };
}

/** Игорь работает каждый будний день недели вперёд. */
function fillWeek(db: Db, employeeId: number, templateId: number | null = null) {
  for (const date of WEEKDAYS) createShift(db, { date, start: "09:00", end: "18:00", employeeId, templateId });
}

describe("runCoverageAdviceTick", () => {
  it("вечером пишет админам про пустые будни недели вперёд — и только им", async () => {
    const { db } = stage();
    const { bot, sent } = testBot();

    const count = await runCoverageAdviceTick(db, bot, EVENING);

    expect(count).toBe(1);
    expect(sent.map((m) => m.chat_id)).toEqual([111]);
    const text = sent[0]!.text;
    expect(text).toMatch(/совет/i);
    expect(text).toContain("Пн 7 сентября — смен нет");
    expect(text).toContain("Пт 11 сентября — смен нет");
    // Окно — семь дней вперёд без сегодняшнего: пустая пятница 04.09 и пустой
    // понедельник 14.09 в письмо не попадают.
    expect(text).not.toContain("4 сентября");
    expect(text).not.toContain("14 сентября");
    expect(listRecentAudit(db, 5)[0]!.type).toBe("coverage_advice_sent");
  });

  it("до часа напоминаний молчит", async () => {
    const { db } = stage();
    const { bot, sent } = testBot();

    expect(await runCoverageAdviceTick(db, bot, { date: TODAY, time: "19:55" })).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("второй тик того же вечера второго письма не шлёт", async () => {
    const { db } = stage();
    const { bot, sent } = testBot();

    await runCoverageAdviceTick(db, bot, EVENING);
    await runCoverageAdviceTick(db, bot, { date: TODAY, time: "20:10" });

    expect(sent).toHaveLength(1);
  });

  it("назавтра пишет снова, если пробелы остались", async () => {
    const { db } = stage();
    const { bot, sent } = testBot();

    await runCoverageAdviceTick(db, bot, EVENING);
    await runCoverageAdviceTick(db, bot, { date: "2026-09-05", time: "20:05" });

    expect(sent).toHaveLength(2);
  });

  it("когда неделя заполнена, молчит и в журнал не пишет", async () => {
    const { db, worker } = stage();
    const { bot, sent } = testBot();
    fillWeek(db, worker.id);

    expect(await runCoverageAdviceTick(db, bot, EVENING)).toBe(0);
    expect(sent).toHaveLength(0);
    expect(listRecentAudit(db, 5).some((e) => e.type === "coverage_advice_sent")).toBe(false);
  });

  it("день ниже нормы называет вид смены и сколько не хватает", async () => {
    const { db, worker } = stage();
    const { bot, sent } = testBot();
    const morning = db
      .insert(shiftTemplates)
      .values({ name: "Утро", category: "shift", start: "08:00", end: "17:00", sendReminder: true })
      .returning()
      .all()[0]!;
    setCoverage(db, morning.id, "2,1,1,1,1,0,0");
    fillWeek(db, worker.id, morning.id);

    await runCoverageAdviceTick(db, bot, EVENING);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Пн 7 сентября — не хватает: Утро — 1");
    expect(sent[0]!.text).not.toContain("8 сентября");
  });

  it("выключивший «пробелы в графике» админ письма не получает", async () => {
    const { db, admin } = stage();
    const { bot, sent } = testBot();
    setNoticeMuted(db, admin.id, "coverage", true);

    await runCoverageAdviceTick(db, bot, EVENING);

    expect(sent).toHaveLength(0);
  });
});
