import { describe, expect, it } from "vitest";
import { Bot } from "grammy";
import { addDaysIso } from "@planer/shared";
import { makeTestDb } from "../db/testdb";
import { createEmployee, createAdminEmployee, linkTelegramAccount, setEmployeeObserver } from "../repo/employees";
import { createShift, deleteShift, getShift, updateShift } from "../repo/shifts";
import { getHandover, listHandoversForEntry } from "../repo/handovers";
import { cancelHandoversForEntryDb, detachHandoversFromEntry, startHandovers, takeHandover } from "../handover/handover-service";
import { listRecentAudit } from "../repo/audit";
import { claimPendingSickLeave, listApprovalMessages } from "../repo/sick-approvals";
import { recordApi, stubBotInfo, callbackDataOf } from "../bot/testbot";
import { entryLineOf } from "../util/message-lines";
import { teamNow } from "../util/team-time";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";
import { approveSickLeave, finishApprovalMessages, listSickApprovals, redrawApprovalMessages, rejectSickLeave, requestApproval, sickApprovalDeps, withdrawExtension } from "./sick-approval-service";

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
    const letters = api.sent.slice(before);
    // Exact admin count: `every` on an empty list would pass for «sent nothing».
    expect(letters).toHaveLength(2);
    expect(letters.every((m) => m.text.endsWith("Нужен ОК любого админа."))).toBe(true);
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
    // Exact set of edited chats: `every` on an empty list would pass without the edits.
    expect(edits.map((e) => e.payload.chat_id).sort()).toEqual([111, 112]);
    for (const edit of edits) {
      expect((edit.payload.text as string).endsWith("\n\n❌ Отклонил(а) Марк")).toBe(true);
      expect(edit.payload.reply_markup).toBeUndefined();
    }
  });

  it("finishes its database work before the first Telegram await: the row is gone, handovers cancelled, a late ✅ is told «нет»", async () => {
    const { db, deps, igor, mark, sick } = await scene();
    const [forced] = await startHandovers(deps, { sickEntry: getShift(db, sick.id)!, employeeId: sick.employeeId! });
    let atFirstAwait: unknown = null;
    // `onDecided` is the first await of the reject: whatever a crash or a second admin
    // would meet at that moment is what this observes.
    await rejectSickLeave(deps, sick.id, mark.id, async () => {
      atFirstAwait = {
        row: getShift(db, sick.id),
        handover: getHandover(db, forced!.id)!.status,
        late: await approveSickLeave(deps, sick.id, igor.id),
      };
    });
    expect(atFirstAwait).toEqual({
      row: undefined,
      handover: "cancelled",
      late: { ok: false, status: 404, text: "Больничного уже нет" },
    });
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

describe("requestApproval — edges", () => {
  it("returns early without sending when the entry is gone", async () => {
    const { deps, api } = await scene();
    const before = api.sent.length;
    const ghost = { id: 99_999, category: "sick_leave", employeeId: 1, date: day(1), endDate: null } as Parameters<typeof requestApproval>[1];
    await requestApproval(deps, ghost);
    expect(api.sent.length).toBe(before);
  });

  it("an admin who decides mid-loop does not leave live buttons with the admins reached later", async () => {
    const db = makeTestDb();
    const bot = stubBotInfo(new Bot("12345:tok"));
    const api = recordApi(bot);
    const igor = createAdminEmployee(db, { displayName: "Игорь", telegramUserId: 111 });
    createAdminEmployee(db, { displayName: "Марк", telegramUserId: 112 });
    const anya = linked(db, 201, "Аня");
    const sick0 = createShift(db, { employeeId: anya.id, date: day(1), category: "sick_leave" });
    const deps = sickApprovalDeps(bot, db, config);
    let fired = false;
    bot.api.config.use(async (prev, method, payload) => {
      const result = await prev(method, payload);
      // Right after the first admin's letter is out, that admin presses «ОК» —
      // before the loop has reached the second one.
      if (!fired && method === "sendMessage" && (payload as { chat_id: number }).chat_id === 111) {
        fired = true;
        await approveSickLeave(deps, sick0.id, igor.id);
      }
      return result;
    });
    await requestApproval(deps, sick0);
    const edited = api.calls.filter((c) => c.method === "editMessageText").map((c) => c.payload.chat_id).sort();
    expect(edited).toEqual([111, 112]);
    expect(listApprovalMessages(db, sick0.id)).toHaveLength(0);
  });
});

/**
 * Аня's sick leave day(1)–day(2) is APPROVED (all approval columns NULL, the way an old row or
 * an admin's entry is written), she works day(1), day(2) and day(3), and now stretches it to day(3).
 */
async function extensionScene() {
  const base = await scene();
  const { db, deps, anya } = base;
  const day3 = createShift(db, { employeeId: anya.id, date: day(3), start: "09:00", end: "18:00", category: "shift", title: "День" });
  const approved = createShift(db, { employeeId: anya.id, date: day(1), endDate: day(2), category: "sick_leave" });
  const stretched = updateShift(db, approved.id, { endDate: day(3) })!;
  const asked = await requestApproval(deps, stretched, { date: approved.date, endDate: approved.endDate });
  const sentBefore = base.api.sent.length;
  return { ...base, day1: base.work, day3, approved, asked, sentBefore };
}

describe("extension of an approved sick leave", () => {
  it("the letter names only the NEW days and carries only their lines; the row remembers the approved span", async () => {
    const { db, api, asked } = await extensionScene();
    const row = getShift(db, asked.id)!;
    expect([row.approvalRequestedAt != null, row.approvedDate, row.approvedEndDate]).toEqual([true, day(1), day(2)]);
    const letter = api.sent.filter((m) => m.chat_id === 111).at(-1)!;
    const lines = letter.text.split("\n");
    // Wrong implementation caught: the whole span in the header (admins re-asked about approved days).
    expect(lines[0]).toMatch(/^🤒 Аня — продление больничного: \d+ [а-я]+\.?$/);
    expect(lines[0]).not.toContain("–");
    // Wrong implementation caught: per-day lines for the approved days.
    expect(lines.some((l) => l.includes("09:00–18:00 · День"))).toBe(true);
    expect(lines.some((l) => l.includes("08:00–17:00"))).toBe(false);
  });

  it("❌ restores the approved span, keeps the old hand-overs, cancels only the new day's, tells the worker, all before the first await", async () => {
    const { db, api, deps, mark, asked, day1, day3 } = await extensionScene();
    // Old day hand-over (live since the first approval) and one on the new day (as if the urgent branch ran).
    const [old] = await startHandovers(deps, { sickEntry: { ...asked, date: day(1), endDate: day(1) }, employeeId: asked.employeeId! });
    const [fresh] = await startHandovers(deps, { sickEntry: { ...asked, date: day(3), endDate: day(3) }, employeeId: asked.employeeId! });
    expect([old!.shiftId, fresh!.shiftId]).toEqual([day1.id, day3.id]);
    let atFirstAwait: unknown = null;

    await rejectSickLeave(deps, asked.id, mark.id, async () => {
      const row = getShift(db, asked.id)!;
      atFirstAwait = { span: [row.date, row.endDate], pending: row.approvalRequestedAt, snap: row.approvedDate, old: getHandover(db, old!.id)!.status, fresh: getHandover(db, fresh!.id)!.status };
    });

    // Wrong implementation caught: deleting the row, or restoring it only after a Telegram await.
    expect(atFirstAwait).toEqual({ span: [day(1), day(2)], pending: null, snap: null, old: "offered", fresh: "cancelled" });
    expect(getShift(db, asked.id)!.approvedDate).toBeNull();
    const toWorker = api.sent.filter((m) => m.chat_id === 201).at(-1)!;
    expect(toWorker.text).toMatch(/^Продление больничного на \d+ [а-я]+ не подтвердил\(а\) Марк — напиши, чтобы разобраться\.$/);
    const edits = api.calls.filter((c) => c.method === "editMessageText");
    expect(edits.map((e) => e.payload.chat_id).sort()).toEqual([111, 112]);
    expect(edits.every((e) => (e.payload.text as string).endsWith("\n\n❌ Отклонил(а) Марк"))).toBe(true);
  });

  it("✅ clears the snapshot and starts drafts only for the NEW days", async () => {
    const { db, deps, igor, asked, day3 } = await extensionScene();
    const res = await approveSickLeave(deps, asked.id, igor.id);

    expect(res.ok).toBe(true);
    const row = getShift(db, asked.id)!;
    expect([row.approvalRequestedAt, row.approvedDate, row.approvedEndDate, row.approvedByEmployeeId]).toEqual([null, null, null, igor.id]);
    // Wrong implementation caught: handing over the whole span (day(1)'s shift also has no hand-over yet here).
    expect(listHandoversForEntry(db, asked.id).map((h) => h.shiftId)).toEqual([day3.id]);
  });

  it("the worker's ✅ message speaks of the extension, not of the whole span", async () => {
    const { api, deps, igor, asked } = await extensionScene();
    await approveSickLeave(deps, asked.id, igor.id);
    const toWorker = api.sent.filter((m) => m.chat_id === 201).at(-1)!;
    expect(toWorker.text).toMatch(/^✅ Продление больничного на \d+ [а-я]+ подтвердил\(а\) Игорь\. Выбери, кому предложить смены$/);
  });

  it("the approvals list says it is an extension and shows only the new days' shifts", async () => {
    const { db, asked } = await extensionScene();
    // The scene's own plain request is in the list too: pick the extension by id.
    const row = listSickApprovals(db).find((r) => r.id === asked.id);
    expect(row!.approvedSpan).toEqual({ date: day(1), endDate: day(2) });
    // Wrong implementation caught: listing day(1)'s shift as taken away by an extension that does not touch it.
    expect(row!.shiftLines).toHaveLength(1);
    expect(row!.shiftLines[0]).toContain("09:00–18:00");
  });
});

/**
 * An EXTENSION request whose send loop is interrupted: right after the first admin's letter is out,
 * `decide` runs (as that admin pressing a button, or the worker deleting). Returns what the admin
 * reached LATER (Марк, 112) finally sees under his letter.
 */
async function lastLineSeenByLaterAdmin(decide: (ctx: { db: Db; deps: ReturnType<typeof sickApprovalDeps>; sick: { id: number }; igorId: number }) => Promise<void>) {
  const db = makeTestDb();
  const bot = stubBotInfo(new Bot("12345:tok"));
  const api = recordApi(bot);
  const igor = createAdminEmployee(db, { displayName: "Игорь", telegramUserId: 111 });
  createAdminEmployee(db, { displayName: "Марк", telegramUserId: 112 });
  const anya = linked(db, 201, "Аня");
  const approved = createShift(db, { employeeId: anya.id, date: day(1), endDate: day(2), category: "sick_leave" });
  const stretched = updateShift(db, approved.id, { endDate: day(3) })!;
  const deps = sickApprovalDeps(bot, db, config);
  let fired = false;
  bot.api.config.use(async (prev, method, payload) => {
    const result = await prev(method, payload);
    if (!fired && method === "sendMessage" && (payload as { chat_id: number }).chat_id === 111) {
      fired = true;
      await decide({ db, deps, sick: stretched, igorId: igor.id });
    }
    return result;
  });
  await requestApproval(deps, stretched, { date: approved.date, endDate: approved.endDate });
  const edit = api.calls.filter((c) => c.method === "editMessageText" && c.payload.chat_id === 112).at(-1);
  return edit ? (edit.payload.text as string).split("\n\n").at(-1) : null;
}

describe("the post-loop close names the decision that really happened", () => {
  it("a ❌ on the extension mid-loop reads «Отклонил(а)», not a false «Подтвердил(а)»", async () => {
    const seen = await lastLineSeenByLaterAdmin(async ({ deps, sick, igorId }) => {
      await rejectSickLeave(deps, sick.id, igorId);
    });
    // Wrong implementation caught: inferring from row state (present, not pending) says «Подтвердил(а) админ».
    expect(seen).toBe("❌ Отклонил(а) Игорь");
  });

  it("the worker deleting mid-loop reads «Больничного уже нет», not «Отклонено»", async () => {
    const seen = await lastLineSeenByLaterAdmin(async ({ db, deps, sick }) => {
      await finishApprovalMessages(deps, sick.id, "x\n\n🗑 Больничного уже нет — Аня снял(а) сам(а)");
      deleteShift(db, sick.id);
    });
    expect(seen).toBe("🗑 Больничного уже нет — Аня снял(а) сам(а)");
  });

  it("an unrecorded change of state reads a neutral «Решение уже принято»", async () => {
    const seen = await lastLineSeenByLaterAdmin(async ({ db, sick }) => {
      claimPendingSickLeave(db, sick.id, null);
    });
    expect(seen).toBe("Решение уже принято");
  });
});

describe("a fresh request", () => {
  it("forgets «передача запущена без ОК» from an earlier round", async () => {
    const { db, deps, anya } = await scene();
    const forced = createShift(db, { employeeId: anya.id, date: day(5), category: "sick_leave", handoverForcedAt: new Date() });
    await requestApproval(deps, forced);
    // Wrong implementation caught: the extension request would inherit the old mark.
    expect(getShift(db, forced.id)!.handoverForcedAt).toBeNull();
  });
});

describe("approveSickLeave — nothing is stranded by a restart or a delete mid-way", () => {
  /** The worker's own delete, as the route does it: letters closed, handovers cancelled and detached, row gone. */
  function workerDeletes(db: Db, id: number) {
    cancelHandoversForEntryDb(db, id, []);
    detachHandoversFromEntry(db, id);
    deleteShift(db, id);
  }

  it("the drafts exist before the first Telegram await: a restart there strands nothing", async () => {
    const { db, deps, igor, sick, work } = await scene();
    // A promise that never settles is a process that died at that await.
    void approveSickLeave(deps, sick.id, igor.id, () => new Promise(() => {}));
    expect(listHandoversForEntry(db, sick.id).map((h) => [h.shiftId, h.status])).toEqual([[work.id, "offered"]]);
  });

  it("the drafts exist before the first admin-letter edit as well (a hang there is a restart too)", async () => {
    const { db, bot, deps, igor, sick, work } = await scene();
    let seenAtFirstEdit: unknown = "never reached";
    bot.api.config.use(async (prev, method, payload) => {
      if (method === "editMessageText" && seenAtFirstEdit === "never reached") {
        seenAtFirstEdit = listHandoversForEntry(db, sick.id).map((h) => h.shiftId);
      }
      return prev(method, payload);
    });
    await approveSickLeave(deps, sick.id, igor.id);
    expect(seenAtFirstEdit).toEqual([work.id]);
  });

  it("the worker deleting the row while the letters are edited: no foreign-key error, no false letter to her", async () => {
    const { db, bot, api, deps, igor, sick } = await scene();
    let fired = false;
    bot.api.config.use(async (prev, method, payload) => {
      if (method === "editMessageText" && !fired) {
        fired = true;
        workerDeletes(db, sick.id);
      }
      return prev(method, payload);
    });
    const res = await approveSickLeave(deps, sick.id, igor.id);
    expect(res.ok).toBe(true);
    expect(getShift(db, sick.id)).toBeUndefined();
    // Wrong implementation caught: «✅ Больничный … подтвердил(а)» to a worker who just took it back.
    expect(api.sent.some((m) => m.chat_id === 201)).toBe(false);
  });

  it("startHandovers stops cleanly when the sick leave disappears while it escalates an uncovered shift", async () => {
    const db = makeTestDb();
    const bot = stubBotInfo(new Bot("12345:tok"));
    recordApi(bot);
    // An observer takes no shifts, so nobody is a candidate — yet he still gets the escalation letters.
    const igor = createAdminEmployee(db, { displayName: "Игорь", telegramUserId: 111 });
    setEmployeeObserver(db, igor.id, true);
    const anya = linked(db, 201, "Аня");
    // Nobody else is free: both shifts escalate at once, with an await between them.
    createShift(db, { employeeId: anya.id, date: day(1), start: "08:00", end: "17:00", category: "shift", title: "Утро" });
    createShift(db, { employeeId: anya.id, date: day(2), start: "08:00", end: "17:00", category: "shift", title: "Утро" });
    const sick = createShift(db, { employeeId: anya.id, date: day(1), endDate: day(2), category: "sick_leave" });
    const deps = sickApprovalDeps(bot, db, config);
    let fired = false;
    bot.api.config.use(async (prev, method, payload) => {
      if (method === "sendMessage" && !fired) {
        fired = true;
        workerDeletes(db, sick.id);
      }
      return prev(method, payload);
    });
    await expect(startHandovers(deps, { sickEntry: sick, employeeId: anya.id })).resolves.toHaveLength(1);
  });
});

describe("rejectSickLeave — a shift a colleague already took", () => {
  it("the worker is told that shift is no longer hers, by name of the taker", async () => {
    const { db, api, deps, mark, sick, oleg, work } = await scene();
    const [urgent] = await startHandovers(deps, { sickEntry: getShift(db, sick.id)!, employeeId: sick.employeeId! });
    expect(await takeHandover(deps, urgent!.id, oleg.id, day(0))).toEqual({ ok: true });
    api.sent.length = 0;

    await rejectSickLeave(deps, sick.id, mark.id);

    const toWorker = api.sent.filter((m) => m.chat_id === 201);
    expect(toWorker).toHaveLength(1);
    const lines = toWorker[0]!.text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(`Смена ${entryLineOf(getShift(db, work.id)!)} уже не твоя: её взял(а) Олег.`);
    // The taken shift stays with its new owner.
    expect(getShift(db, work.id)!.employeeId).toBe(oleg.id);
  });

  it("a plain rejection with nothing taken says nothing about shifts", async () => {
    const { api, deps, mark, sick } = await scene();
    await rejectSickLeave(deps, sick.id, mark.id);
    expect(api.sent.find((m) => m.chat_id === 201)!.text).not.toContain("\n");
  });
});

describe("redrawApprovalMessages", () => {
  it("a decision landing between two edits is not undone: the second letter keeps no buttons", async () => {
    const { db, bot, api, deps, igor, sick } = await scene();
    let fired = false;
    bot.api.config.use(async (prev, method, payload) => {
      const result = await prev(method, payload);
      if (method === "editMessageText" && !fired) {
        fired = true;
        // The first admin presses «ОК» right after the first redraw went out.
        await approveSickLeave(deps, sick.id, igor.id);
      }
      return result;
    });
    await redrawApprovalMessages(deps, getShift(db, sick.id)!);
    const edits = api.calls.filter((c) => c.method === "editMessageText");
    // Exactly one redraw (with buttons) and the two decision edits (without): a second redraw would bring the buttons back.
    expect(edits.filter((e) => e.payload.reply_markup != null)).toHaveLength(1);
    const lastPerChat = new Map(edits.map((e) => [e.payload.chat_id, e.payload]));
    expect([...lastPerChat.values()].every((p) => p.reply_markup == null)).toBe(true);
  });
});

describe("withdrawExtension and the approver", () => {
  it("keeps the person who approved the original span", async () => {
    const base = await scene();
    const { db, deps, igor, anya } = base;
    const approved = createShift(db, { employeeId: anya.id, date: day(5), endDate: day(6), category: "sick_leave", approvedByEmployeeId: igor.id });
    const stretched = updateShift(db, approved.id, { endDate: day(7) })!;
    const asked = await requestApproval(deps, stretched, { date: approved.date, endDate: approved.endDate });
    expect(getShift(db, asked.id)!.approvedByEmployeeId).toBe(igor.id); // the request itself keeps it too
    await withdrawExtension(deps, asked);
    const row = getShift(db, asked.id)!;
    expect([row.approvalRequestedAt, row.approvedByEmployeeId]).toEqual([null, igor.id]);
  });

  it("a rejected extension keeps it as well", async () => {
    const { db, deps, igor, mark, anya } = await scene();
    const approved = createShift(db, { employeeId: anya.id, date: day(5), endDate: day(6), category: "sick_leave", approvedByEmployeeId: igor.id });
    const stretched = updateShift(db, approved.id, { endDate: day(7) })!;
    const asked = await requestApproval(deps, stretched, { date: approved.date, endDate: approved.endDate });
    await rejectSickLeave(deps, asked.id, mark.id);
    expect(getShift(db, asked.id)!.approvedByEmployeeId).toBe(igor.id);
  });
});

describe("listSickApprovals — the cap", () => {
  it("newest requests come first: old undecided ones cannot push a fresh request past the limit", async () => {
    const { db, anya } = await scene();
    for (let i = 0; i < 100; i++) {
      createShift(db, { employeeId: anya.id, date: day(-400 + i), category: "sick_leave", approvalRequestedAt: new Date(Date.UTC(2026, 0, 1, 0, i)) });
    }
    const fresh = createShift(db, { employeeId: anya.id, date: day(10), category: "sick_leave", approvalRequestedAt: new Date() });
    const ids = listSickApprovals(db).map((r) => r.id);
    expect(ids).toHaveLength(100);
    expect(ids[0]).toBe(fresh.id);
    expect(ids).toContain(fresh.id);
  });
});
