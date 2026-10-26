import { describe, expect, it } from "vitest";
import { Bot } from "grammy";
import { addDaysIso } from "@planer/shared";
import { makeTestDb } from "../db/testdb";
import { createEmployee, createAdminEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift, getShift, updateShift } from "../repo/shifts";
import { listApprovalMessages } from "../repo/sick-approvals";
import { recordApi, stubBotInfo, callbackDataOf } from "../bot/testbot";
import { teamNow } from "../util/team-time";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";
import {
  approveSickLeave,
  rejectSickLeave,
  requestApproval,
  runSickApprovalReminderTick,
  sickApprovalDeps,
  SICK_APPROVAL_REMIND_HOURS,
} from "./sick-approval-service";

const config = testConfig();
const day = (n: number) => addDaysIso(teamNow(config.teamTz).date, n);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
/** The moment the request is made — fixed, so the tick's age arithmetic is exact. */
const ASKED = Date.UTC(2026, 9, 26, 9, 0);

function linked(db: Db, tgId: number, displayName: string) {
  createEmployee(db, { displayName, inviteToken: `tok-${tgId}` });
  return linkTelegramAccount(db, `tok-${tgId}`, tgId, `u${tgId}`, displayName)!;
}

/** Аня (tg 201) asks for a sick leave day(1)–day(2) at ASKED; Игорь (111) and Марк (112) are admins. */
async function scene() {
  const db = makeTestDb();
  const bot = stubBotInfo(new Bot("12345:tok"));
  const api = recordApi(bot);
  const igor = createAdminEmployee(db, { displayName: "Игорь", telegramUserId: 111 });
  createAdminEmployee(db, { displayName: "Марк", telegramUserId: 112 });
  const anya = linked(db, 201, "Аня");
  const deps = { ...sickApprovalDeps(bot, db, config), now: () => ASKED };
  const sick = await requestApproval(deps, createShift(db, { employeeId: anya.id, date: day(1), endDate: day(2), category: "sick_leave" }));
  const sentBefore = api.sent.length;
  return { db, bot, api, deps, igor, anya, sick, sentBefore };
}

const at = (ms: number) => new Date(ASKED + ms);

describe("runSickApprovalReminderTick", () => {
  it("is four hours", () => {
    expect(SICK_APPROVAL_REMIND_HOURS).toBe(4);
  });

  it("3 h 59 min: nothing yet", async () => {
    const { db, bot, api, sentBefore } = await scene();
    expect(await runSickApprovalReminderTick(db, bot, at(4 * HOUR - MIN))).toBe(0);
    expect(api.sent.length).toBe(sentBefore);
  });

  it("4 h 1 min: one letter per admin, with the same decision buttons as the request, tracked like the request", async () => {
    const { db, bot, api, sick, sentBefore } = await scene();
    expect(await runSickApprovalReminderTick(db, bot, at(4 * HOUR + MIN))).toBe(2);
    const letters = api.sent.slice(sentBefore);
    expect(letters.map((m) => m.chat_id).sort()).toEqual([111, 112]);
    for (const letter of letters) {
      expect(letter.text).toMatch(/^⏳ Больничный Аня \(.+\) ждёт решения уже 4 ч\.$/);
      expect(callbackDataOf(letter)).toEqual([`sick:approve:${sick.id}`, `sick:reject:${sick.id}`]);
    }
    // Two from the request, two from the reminder: a decision must reach all four.
    expect(listApprovalMessages(db, sick.id)).toHaveLength(4);
  });

  it("the age is said as it is: a request left for 30 hours (bot down) does not read «4 ч»", async () => {
    const { db, bot, api, sentBefore } = await scene();
    await runSickApprovalReminderTick(db, bot, at(30 * HOUR + 10 * MIN));
    expect(api.sent.slice(sentBefore)[0]!.text).toMatch(/ждёт решения уже 30 ч\.$/);
  });

  it("only once per request: the second tick sends nothing", async () => {
    const { db, bot, api, sentBefore } = await scene();
    await runSickApprovalReminderTick(db, bot, at(4 * HOUR + MIN));
    expect(await runSickApprovalReminderTick(db, bot, at(5 * HOUR))).toBe(0);
    expect(api.sent.length).toBe(sentBefore + 2);
  });

  it("a decided request is not reminded about", async () => {
    const { db, bot, api, deps, igor, sick } = await scene();
    await approveSickLeave(deps, sick.id, igor.id);
    const before = api.sent.length;
    expect(await runSickApprovalReminderTick(db, bot, at(4 * HOUR + MIN))).toBe(0);
    expect(api.sent.length).toBe(before);
  });

  it("a decision after the reminder takes the buttons off the reminder letters too", async () => {
    const { db, bot, api, deps, igor, sick } = await scene();
    await runSickApprovalReminderTick(db, bot, at(4 * HOUR + MIN));
    const reminderIds = api.calls
      .filter((c) => c.method === "sendMessage" && String(c.payload.text).startsWith("⏳"))
      .map((c) => c.payload.chat_id);
    expect(reminderIds).toHaveLength(2);
    await approveSickLeave(deps, sick.id, igor.id);
    // 4 tracked letters, 4 edits without buttons — the reminder copies included.
    const edits = api.calls.filter((c) => c.method === "editMessageText");
    expect(edits).toHaveLength(4);
    expect(edits.every((e) => e.payload.reply_markup === undefined)).toBe(true);
  });

  it("a decision landing mid-loop: the later reminder letter is closed, not left with live buttons", async () => {
    const { db, bot, api, deps, igor, sick } = await scene();
    let fired = false;
    bot.api.config.use(async (prev, method, payload) => {
      const result = await prev(method, payload);
      const p = payload as { chat_id: number; text?: string };
      if (!fired && method === "sendMessage" && p.text?.startsWith("⏳") && p.chat_id === 111) {
        fired = true;
        await rejectSickLeave(deps, sick.id, igor.id);
      }
      return result;
    });
    await runSickApprovalReminderTick(db, bot, at(4 * HOUR + MIN));
    const reminderTo112 = api.calls.find((c) => c.method === "sendMessage" && c.payload.chat_id === 112 && String(c.payload.text).startsWith("⏳"));
    expect(reminderTo112).toBeDefined();
    const editOf112 = api.calls.filter((c) => c.method === "editMessageText" && c.payload.chat_id === 112).at(-1)!;
    expect(String(editOf112.payload.text).startsWith("⏳")).toBe(true);
    expect(String(editOf112.payload.text).endsWith("\n\nРешение уже принято")).toBe(true);
    expect(editOf112.payload.reply_markup).toBeUndefined();
    expect(getShift(db, sick.id)).toBeUndefined();
  });

  it("an «ОК» landing mid-loop (the row stays): the later letter is closed and not left tracked with live buttons", async () => {
    const { db, bot, api, deps, igor, sick } = await scene();
    let fired = false;
    bot.api.config.use(async (prev, method, payload) => {
      const result = await prev(method, payload);
      const p = payload as { chat_id: number; text?: string };
      if (!fired && method === "sendMessage" && p.text?.startsWith("⏳") && p.chat_id === 111) {
        fired = true;
        await approveSickLeave(deps, sick.id, igor.id);
      }
      return result;
    });
    await runSickApprovalReminderTick(db, bot, at(4 * HOUR + MIN));
    const editOf112 = api.calls.filter((c) => c.method === "editMessageText" && c.payload.chat_id === 112).at(-1)!;
    expect(String(editOf112.payload.text)).toMatch(/^⏳[^]*\n\nРешение уже принято$/);
    expect(listApprovalMessages(db, sick.id)).toHaveLength(0);
  });

  it("delivered to nobody: no mark, the next tick tries again", async () => {
    const { db, bot, api, sentBefore } = await scene();
    let down = true;
    bot.api.config.use(async (prev, method, payload) => {
      if (down && method === "sendMessage") throw new Error("network down");
      return prev(method, payload);
    });
    expect(await runSickApprovalReminderTick(db, bot, at(4 * HOUR + MIN))).toBe(0);
    down = false;
    expect(await runSickApprovalReminderTick(db, bot, at(4 * HOUR + 6 * MIN))).toBe(2);
    expect(api.sent.length).toBe(sentBefore + 2);
  });

  it("the sick admin herself is not reminded about her own request, as she was not asked", async () => {
    const { db, bot, api, deps, igor } = await scene();
    const own = await requestApproval({ ...deps, now: () => ASKED }, createShift(db, { employeeId: igor.id, date: day(4), category: "sick_leave" }));
    const before = api.sent.length;
    await runSickApprovalReminderTick(db, bot, at(4 * HOUR + MIN));
    const aboutOwn = api.sent.slice(before).filter((m) => callbackDataOf(m)[0] === `sick:approve:${own.id}`);
    expect(aboutOwn.map((m) => m.chat_id)).toEqual([112]);
  });

  it("an extension asked later is a new question: it is reminded about again, naming the extension", async () => {
    const { db, bot, api, deps, igor, sick } = await scene();
    await runSickApprovalReminderTick(db, bot, at(4 * HOUR + MIN));
    await approveSickLeave(deps, sick.id, igor.id);
    const stretched = updateShift(db, sick.id, { endDate: day(3) })!;
    const later = ASKED + 24 * HOUR;
    await requestApproval({ ...deps, now: () => later }, stretched, { date: day(1), endDate: day(2) });
    const before = api.sent.length;
    // Too early for the new round, even though the first round is long past four hours.
    expect(await runSickApprovalReminderTick(db, bot, new Date(later + 3 * HOUR))).toBe(0);
    expect(await runSickApprovalReminderTick(db, bot, new Date(later + 4 * HOUR + MIN))).toBe(2);
    const letters = api.sent.slice(before);
    expect(letters).toHaveLength(2);
    expect(letters[0]!.text).toMatch(/^⏳ Продление больничного Аня \(.+\) ждёт решения уже 4 ч\.$/);
  });
});
