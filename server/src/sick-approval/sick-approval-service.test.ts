import { describe, expect, it } from "vitest";
import { Bot } from "grammy";
import { addDaysIso } from "@planer/shared";
import { makeTestDb } from "../db/testdb";
import { createEmployee, createAdminEmployee, linkTelegramAccount, setEmployeeObserver } from "../repo/employees";
import { createShift, getShift } from "../repo/shifts";
import { getHandover, listHandoversForEntry } from "../repo/handovers";
import { startHandovers } from "../handover/handover-service";
import { listRecentAudit } from "../repo/audit";
import { listApprovalMessages } from "../repo/sick-approvals";
import { recordApi, stubBotInfo, callbackDataOf } from "../bot/testbot";
import { teamNow } from "../util/team-time";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";
import { approveSickLeave, listSickApprovals, rejectSickLeave, requestApproval, sickApprovalDeps } from "./sick-approval-service";

const config = testConfig();
const day = (n: number) => addDaysIso(teamNow(config.teamTz).date, n);

function linked(db: Db, tgId: number, displayName: string) {
  createEmployee(db, { displayName, inviteToken: `tok-${tgId}` });
  return linkTelegramAccount(db, `tok-${tgId}`, tgId, `u${tgId}`, displayName)!;
}

/** Аня (worker, tg 201) on sick leave over her shift tomorrow; Олег free; Игорь (111) and Марк (112) admins. */
async function scene() {
  const db = makeTestDb();
  const bot = stubBotInfo(new Bot("12345:tok"));
  const api = recordApi(bot);
  const igor = createAdminEmployee(db, { displayName: "Игорь", telegramUserId: 111 });
  const mark = createAdminEmployee(db, { displayName: "Марк", telegramUserId: 112 });
  const anya = linked(db, 201, "Аня");
  const oleg = linked(db, 202, "Олег");
  const work = createShift(db, { employeeId: anya.id, date: day(1), start: "08:00", end: "17:00", category: "shift", title: "Утро" });
  const sick0 = createShift(db, { employeeId: anya.id, date: day(1), endDate: day(2), category: "sick_leave" });
  const deps = sickApprovalDeps(bot, db, config);
  const sick = await requestApproval(deps, sick0);
  return { db, bot, api, deps, igor, mark, anya, oleg, work, sick };
}

describe("requestApproval", () => {
  it("marks the entry pending and sends every admin one letter with «ОК» and «Отклонить»", async () => {
    const { db, api, sick } = await scene();
    expect(getShift(db, sick.id)!.approvalRequestedAt).not.toBeNull();
    expect(api.sent.map((m) => m.chat_id).sort()).toEqual([111, 112]);
    expect(callbackDataOf(api.sent[0]!)).toEqual([`sick:approve:${sick.id}`, `sick:reject:${sick.id}`]);
    const lines = api.sent[0]!.text.split("\n");
    expect(lines[0]).toMatch(/^🤒 Аня — больничный /);
    expect(lines.some((l) => l.includes("08:00–17:00 · Утро"))).toBe(true);
    expect(lines.at(-1)).toBe("Передача смен начнётся после ОК.");
    expect(listApprovalMessages(db, sick.id)).toHaveLength(2);
    // No handover before the «ОК» — that is the whole point.
    expect(listHandoversForEntry(db, sick.id)).toHaveLength(0);
  });

  it("an observer's request says only that an «ОК» is needed — they hand nothing over", async () => {
    const { db, deps, api } = await scene();
    const dasha = linked(db, 203, "Даша");
    setEmployeeObserver(db, dasha.id, true);
    const before = api.sent.length;
    await requestApproval(deps, createShift(db, { employeeId: dasha.id, date: day(1), category: "sick_leave" }));
    expect(api.sent.slice(before).every((m) => m.text.endsWith("Нужен ОК любого админа."))).toBe(true);
  });
});

describe("approveSickLeave", () => {
  it("approves, starts the hand-over as DRAFTS (not fanned), tells the worker with a button, and replaces the buttons for EVERY admin", async () => {
    const { db, api, deps, igor, sick, work } = await scene();
    const res = await approveSickLeave(deps, sick.id, igor.id);

    expect(res).toEqual({ ok: true, adminName: "Игорь" });
    const after = getShift(db, sick.id)!;
    expect(after.approvalRequestedAt).toBeNull();
    expect(after.approvedByEmployeeId).toBe(igor.id);
    const handovers = listHandoversForEntry(db, sick.id);
    // Drafts, exactly as a sick leave created today makes them: no addressee, nobody asked yet.
    expect(handovers.map((h) => [h.shiftId, h.status, h.offeredToEmployeeId])).toEqual([[work.id, "offered", null]]);
    expect(api.calls.some((c) => c.method === "sendMessage" && c.payload.chat_id === 202)).toBe(false); // Олег not asked
    expect(listRecentAudit(db, 20).map((r) => r.type)).toContain("sick_leave_approved");

    const edits = api.calls.filter((c) => c.method === "editMessageText");
    expect(edits.map((e) => e.payload.chat_id).sort()).toEqual([111, 112]);
    for (const edit of edits) {
      expect(edit.payload.text.endsWith("\n\n✅ Подтвердил(а) Игорь")).toBe(true);
      expect(edit.payload.reply_markup).toBeUndefined();
    }
    expect(listApprovalMessages(db, sick.id)).toHaveLength(0);
    const toWorker = api.sent.find((m) => m.chat_id === 201)!;
    expect(toWorker.text).toMatch(/^✅ Больничный .+ подтвердил\(а\) Игорь\. Выбери, кому предложить смены$/);
    const button = toWorker.reply_markup!.inline_keyboard[0]![0]!;
    expect(button.text).toBe("🤝 Выбрать коллег");
    expect("web_app" in button && button.web_app.url).toBe("https://example.com/app/?screen=handovers");
  });

  it("no shift to hand over — the worker is told, without a button to an empty step", async () => {
    const { db, api, deps, igor, anya } = await scene();
    const bare = await requestApproval(deps, createShift(db, { employeeId: anya.id, date: day(5), category: "sick_leave" }));
    await approveSickLeave(deps, bare.id, igor.id);
    const toWorker = api.sent.filter((m) => m.chat_id === 201).at(-1)!;
    expect(toWorker.text.endsWith("подтвердил(а) Игорь.")).toBe(true);
    expect(toWorker.reply_markup).toBeUndefined();
  });

  it("two admins in the same second: exactly one approves, the handover starts once", async () => {
    const { db, deps, igor, mark, sick } = await scene();
    const [a, b] = await Promise.all([approveSickLeave(deps, sick.id, igor.id), approveSickLeave(deps, sick.id, mark.id)]);
    expect([a.ok, b.ok]).toEqual([true, false]);
    expect(b).toEqual({ ok: false, status: 409, text: "Уже подтвердил(а) Игорь" });
    expect(listHandoversForEntry(db, sick.id)).toHaveLength(1);
    expect(listRecentAudit(db, 20).filter((r) => r.type === "sick_leave_approved")).toHaveLength(1);
  });

  it("a deleted entry and an old (never-asked) one are refused in words, not crashed on", async () => {
    const { db, deps, igor } = await scene();
    expect(await approveSickLeave(deps, 99_999, igor.id)).toEqual({ ok: false, status: 404, text: "Больничного уже нет" });
    const old = createShift(db, { date: day(3), category: "sick_leave", employeeId: igor.id });
    expect(await approveSickLeave(deps, old.id, igor.id)).toEqual({ ok: false, status: 409, text: "Больничный уже подтверждён" });
  });
});

describe("rejectSickLeave", () => {
  it("deletes the entry, cancels what already started, tells the worker who to talk to", async () => {
    const { db, api, deps, mark, sick } = await scene();
    // As if the urgent branch had already handed the shift over.
    const [forced] = await startHandovers(deps, { sickEntry: getShift(db, sick.id)!, employeeId: sick.employeeId! });

    const res = await rejectSickLeave(deps, sick.id, mark.id);

    expect(res.ok).toBe(true);
    expect(getShift(db, sick.id)).toBeUndefined();
    expect(listHandoversForEntry(db, sick.id)).toHaveLength(0); // detached
    expect(getHandover(db, forced!.id)!.status).toBe("cancelled");
    expect(listRecentAudit(db, 20).map((r) => r.type)).toContain("sick_leave_rejected");
    const toWorker = api.sent.find((m) => m.chat_id === 201)!;
    expect(toWorker.text).toMatch(/^Больничный с \d+ (по \d+ )?[а-я]+( по \d+ [а-я]+)? не подтвердил\(а\) Марк — напиши, чтобы разобраться\.$/);
    const edits = api.calls.filter((c) => c.method === "editMessageText");
    expect(edits.every((e) => (e.payload.text as string).endsWith("❌ Отклонил(а) Марк"))).toBe(true);
  });
});

describe("listSickApprovals", () => {
  it("lists pending sick leaves with the shifts they take, and not the approved ones", async () => {
    const { db, deps, igor, sick } = await scene();
    const rows = listSickApprovals(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: sick.id, employeeName: "Аня", handoverForced: false });
    expect(rows[0]!.shiftLines[0]).toContain("08:00–17:00 · Утро");
    await approveSickLeave(deps, sick.id, igor.id);
    expect(listSickApprovals(db)).toEqual([]);
  });
});
