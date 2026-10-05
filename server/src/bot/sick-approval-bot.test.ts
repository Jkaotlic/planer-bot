import { describe, expect, it } from "vitest";
import { addDaysIso } from "@planer/shared";
import { createBot } from "./bot";
import { callbackDataOf, recordApi, stubBotInfo } from "./testbot";
import { makeTestDb } from "../db/testdb";
import { createAdminEmployee, createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift, deleteShift, getShift } from "../repo/shifts";
import { listHandoversForEntry } from "../repo/handovers";
import { requestApproval, sickApprovalDeps } from "../sick-approval/sick-approval-service";
import { teamNow } from "../util/team-time";
import { testConfig } from "../test-config";

const config = testConfig();
const day = (n: number) => addDaysIso(teamNow(config.teamTz).date, n);

function press(tgId: number, data: string, messageId = 5) {
  return {
    update_id: 9,
    callback_query: {
      id: `cbq-${tgId}`,
      from: { id: tgId, is_bot: false, first_name: "T" },
      message: { message_id: messageId, date: 1_712_803_046, chat: { id: tgId, first_name: "T", type: "private" as const }, text: "🤒 Аня — больничный" },
      chat_instance: "x",
      data,
    },
  };
}

async function scene() {
  const db = makeTestDb();
  const bot = stubBotInfo(createBot({ db, config }));
  const api = recordApi(bot);
  createAdminEmployee(db, { displayName: "Игорь", telegramUserId: 111 });
  createAdminEmployee(db, { displayName: "Марк", telegramUserId: 112 });
  createEmployee(db, { displayName: "Аня", inviteToken: "tok-anya" });
  const anya = linkTelegramAccount(db, "tok-anya", 201)!;
  createEmployee(db, { displayName: "Олег", inviteToken: "tok-oleg" });
  linkTelegramAccount(db, "tok-oleg", 202);
  createShift(db, { employeeId: anya.id, date: day(1), start: "08:00", end: "17:00", category: "shift", title: "Утро" });
  const sick = await requestApproval(sickApprovalDeps(bot, db, config), createShift(db, { employeeId: anya.id, date: day(1), category: "sick_leave" }));
  return { db, bot, api, sick };
}

describe("sick leave buttons", () => {
  it("each admin's letter carries «ОК» and «Отклонить» for this entry", async () => {
    const { api, sick } = await scene();
    expect(api.sent).toHaveLength(2); // two admins: a loop over an empty list must not pass
    for (const message of api.sent) expect(callbackDataOf(message)).toEqual([`sick:approve:${sick.id}`, `sick:reject:${sick.id}`]);
  });

  it("«ОК» approves, answers the tap, and replaces the buttons for both admins", async () => {
    const { db, bot, api, sick } = await scene();
    await bot.handleUpdate(press(111, `sick:approve:${sick.id}`) as never);
    expect(api.answers).toContain("Подтверждено ✅");
    expect(getShift(db, sick.id)!.approvalRequestedAt).toBeNull();
    expect(listHandoversForEntry(db, sick.id)).toHaveLength(1);
    const edits = api.calls.filter((c) => c.method === "editMessageText");
    expect(edits.map((e) => e.payload.chat_id).sort()).toEqual([111, 112]);
    expect(edits.every((e) => (e.payload.text as string).endsWith("✅ Подтвердил(а) Игорь"))).toBe(true);
  });

  it("«Отклонить» deletes the entry, answers the tap and closes both letters", async () => {
    const { db, bot, api, sick } = await scene();
    await bot.handleUpdate(press(112, `sick:reject:${sick.id}`) as never);
    expect(api.answers).toContain("Отклонено");
    expect(getShift(db, sick.id)).toBeUndefined();
    const edits = api.calls.filter((c) => c.method === "editMessageText");
    expect(edits.every((e) => (e.payload.text as string).endsWith("❌ Отклонил(а) Марк"))).toBe(true);
    expect(edits).toHaveLength(2);
  });

  it("the second admin's «ОК» is answered «Уже подтвердил(а) Игорь» and starts nothing new", async () => {
    const { db, bot, api, sick } = await scene();
    await bot.handleUpdate(press(111, `sick:approve:${sick.id}`) as never);
    await bot.handleUpdate(press(112, `sick:approve:${sick.id}`) as never);
    expect(api.answers.at(-1)).toBe("Уже подтвердил(а) Игорь");
    expect(listHandoversForEntry(db, sick.id)).toHaveLength(1);
  });

  it("a worker pressing the button changes nothing", async () => {
    const { db, bot, api, sick } = await scene();
    await bot.handleUpdate(press(201, `sick:approve:${sick.id}`) as never);
    expect(api.answers.at(-1)).toBe("Это может только админ");
    expect(getShift(db, sick.id)!.approvalRequestedAt).not.toBeNull();
    expect(listHandoversForEntry(db, sick.id)).toHaveLength(0);
    expect(api.calls.filter((c) => c.method === "editMessageText")).toHaveLength(0);
  });

  it("someone unknown to the bot is told «Ты не в системе» and changes nothing", async () => {
    const { db, bot, api, sick } = await scene();
    await bot.handleUpdate(press(999, `sick:approve:${sick.id}`) as never);
    expect(api.answers.at(-1)).toBe("Ты не в системе");
    expect(getShift(db, sick.id)!.approvalRequestedAt).not.toBeNull();
    expect(listHandoversForEntry(db, sick.id)).toHaveLength(0);
    expect(api.calls.filter((c) => c.method === "editMessageText")).toHaveLength(0);
  });

  it("a button for a deleted sick leave says «Больничного уже нет» on the tap and in the message", async () => {
    const { db, bot, api, sick } = await scene();
    deleteShift(db, sick.id);
    await bot.handleUpdate(press(112, `sick:reject:${sick.id}`, 7) as never);
    expect(api.answers.at(-1)).toBe("Больничного уже нет");
    const edit = api.calls.filter((c) => c.method === "editMessageText").at(-1)!;
    expect(edit.payload.message_id).toBe(7);
    expect(edit.payload.text).toBe("🤒 Аня — больничный\n\nБольничного уже нет");
  });
});
