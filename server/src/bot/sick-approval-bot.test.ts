import { describe, expect, it } from "vitest";
import { addDaysIso } from "@planer/shared";
import { createBot } from "./bot";
import { callbackDataOf, recordApi, stubBotInfo } from "./testbot";
import { makeTestDb } from "../db/testdb";
import { createAdminEmployee, createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift, deleteShift, getShift, updateShift } from "../repo/shifts";
import { listHandoversForEntry } from "../repo/handovers";
import { listApprovalMessages } from "../repo/sick-approvals";
import { approveSickLeave, requestApproval, sickApprovalDeps } from "../sick-approval/sick-approval-service";
import { teamNow } from "../util/team-time";
import { testConfig } from "../test-config";

const config = testConfig();
const day = (n: number) => addDaysIso(teamNow(config.teamTz).date, n);

function press(tgId: number, data: string, messageId = tgId === 112 ? 2 : 1, date = Math.floor(Date.now() / 1000)) {
  return {
    update_id: 9,
    callback_query: {
      id: `cbq-${tgId}`,
      from: { id: tgId, is_bot: false, first_name: "T" },
      message: { message_id: messageId, date, chat: { id: tgId, first_name: "T", type: "private" as const }, text: "🤒 Аня — больничный" },
      chat_instance: "x",
      data,
    },
  };
}

async function scene() {
  const db = makeTestDb();
  const bot = stubBotInfo(createBot({ db, config }));
  const api = recordApi(bot);
  const igor = createAdminEmployee(db, { displayName: "Игорь", telegramUserId: 111 });
  createAdminEmployee(db, { displayName: "Марк", telegramUserId: 112 });
  createEmployee(db, { displayName: "Аня", inviteToken: "tok-anya" });
  const anya = linkTelegramAccount(db, "tok-anya", 201)!;
  createEmployee(db, { displayName: "Олег", inviteToken: "tok-oleg" });
  linkTelegramAccount(db, "tok-oleg", 202);
  createShift(db, { employeeId: anya.id, date: day(1), start: "08:00", end: "17:00", category: "shift", title: "Утро" });
  const sick = await requestApproval(sickApprovalDeps(bot, db, config), createShift(db, { employeeId: anya.id, date: day(1), category: "sick_leave" }));
  return { db, bot, api, sick, igor };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
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

  it("a button from the first request cannot reject an extension, even within the same second", async () => {
    const { db, bot, api, sick } = await scene();
    await bot.handleUpdate(press(111, `sick:approve:${sick.id}`) as never);
    const deps = { ...sickApprovalDeps(bot, db, config), now: () => sick.approvalRequestedAt!.getTime() };
    const stretched = updateShift(db, sick.id, { endDate: day(2) })!;
    await requestApproval(deps, stretched, { date: day(1), endDate: null });

    await bot.handleUpdate(press(111, `sick:reject:${sick.id}`, 1) as never);
    expect(api.answers.at(-1)).toContain("устарела");
    expect(getShift(db, sick.id)).toMatchObject({ endDate: day(2), approvalRequestedAt: sick.approvalRequestedAt });

    const current = listApprovalMessages(db, sick.id).find((letter) => letter.chatId === 111)!;
    await bot.handleUpdate(press(111, `sick:approve:${sick.id}`, current.messageId) as never);
    expect(api.answers.at(-1)).toBe("Подтверждено ✅");
    expect(getShift(db, sick.id)).toMatchObject({ endDate: day(2), approvalRequestedAt: null });
  });

  it("a delayed send from an older round cannot join a newer request's letters", async () => {
    const { db, bot, api, sick, igor } = await scene();
    const deps = { ...sickApprovalDeps(bot, db, config), now: () => sick.approvalRequestedAt!.getTime() };
    await approveSickLeave(deps, sick.id, igor.id);
    const sending = deferred();
    const unblock = deferred();
    let lateMessageId: number | undefined;
    bot.api.config.use(async (prev, method, payload) => {
      const result = await prev(method, payload);
      if (method === "sendMessage" && (payload as { chat_id: number }).chat_id === 111 && lateMessageId == null) {
        lateMessageId = (result as { result: { message_id: number } }).result.message_id;
        sending.resolve();
        await unblock.promise;
      }
      return result;
    });
    const firstExtension = requestApproval(deps, updateShift(db, sick.id, { endDate: day(2) })!, { date: day(1), endDate: null });
    await sending.promise;
    await approveSickLeave(deps, sick.id, igor.id);
    await requestApproval(deps, updateShift(db, sick.id, { endDate: day(3) })!, { date: day(1), endDate: day(2) });
    const current = listApprovalMessages(db, sick.id);
    unblock.resolve();
    await firstExtension;

    expect(listApprovalMessages(db, sick.id)).toEqual(current);
    await bot.handleUpdate(press(111, `sick:approve:${sick.id}`, lateMessageId) as never);
    expect(api.answers.at(-1)).toContain("устарела");
    expect(getShift(db, sick.id)?.approvalRequestedAt).not.toBeNull();
  });

  it("the first approval cannot take away the new request's letters while finishing", async () => {
    const { db, bot, sick, igor } = await scene();
    const deps = sickApprovalDeps(bot, db, config);
    const decided = deferred();
    const unblock = deferred();
    const first = approveSickLeave(deps, sick.id, igor.id, () => {
      decided.resolve();
      return unblock.promise;
    });
    await decided.promise;
    await requestApproval(deps, updateShift(db, sick.id, { endDate: day(2) })!, { date: day(1), endDate: null });
    const current = listApprovalMessages(db, sick.id);
    unblock.resolve();
    await first;

    expect(current).toHaveLength(2);
    expect(listApprovalMessages(db, sick.id)).toEqual(current);
  });
});
