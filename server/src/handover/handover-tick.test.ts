import { describe, it, expect, beforeEach } from "vitest";
import { makeTestDb } from "../db/testdb";
import { employees, shifts, auditLog, type Shift } from "../db/schema";
import { getHandover, listHandoversForEntry, updateHandover } from "../repo/handovers";
import { approveSickLeave, sickApprovalDeps } from "../sick-approval/sick-approval-service";
import { updateShift, deleteShift, getShift } from "../repo/shifts";
import { startHandovers, offerTo, handoverVoidReason } from "./handover-service";
import { runHandoverTick } from "./handover-tick";
import type { Db } from "../db/client";

const HOUR = 60 * 60 * 1000;
/** 12 авг 2026, 09:00 по Москве — то есть 06:00 UTC. */
const NOW = Date.UTC(2026, 7, 12, 6, 0);

let sent: { to: string; text: string }[] = [];

function deps(db: Db) {
  return {
    db,
    config: { teamTz: "Europe/Moscow", publicUrl: "https://example.com", handoverFanHours: 3, handoverEscalateHours: 12 },
    // Передачи рождаются ночью 12-го (03:00 МСК) — до самой ранней фикстуры (05:00);
    // «сейчас» самого тика задаёт его второй аргумент.
    now: () => NOW - 6 * HOUR,
    messenger: {
      offer: async (employeeId: number, _h: number, text: string) => {
        sent.push({ to: `employee:${employeeId}`, text });
      },
      fan: async (ids: readonly number[], _h: number, text: string) => {
        for (const id of ids) sent.push({ to: `employee:${id}`, text });
      },
      plain: async (employeeId: number, text: string) => {
        sent.push({ to: `employee:${employeeId}`, text });
      },
      admins: async (text: string) => {
        sent.push({ to: "admins", text });
      },
      adminsAlways: async (text: string) => {
        sent.push({ to: "admins", text });
        return { attempted: 1, delivered: 1 };
      },
    },
  };
}

type TestDb = ReturnType<typeof makeTestDb>;

function person(db: TestDb, displayName: string): number {
  return db.insert(employees).values({ displayName }).returning().get().id;
}

function shift(db: TestDb, employeeId: number, date: string, start = "15:00", end = "23:00"): Shift {
  return db.insert(shifts).values({ date, start, end, category: "shift", title: "Вечер", employeeId }).returning().get();
}

function sickLeave(db: TestDb, employeeId: number, date: string): Shift {
  return db.insert(shifts).values({ date, endDate: date, category: "sick_leave", employeeId }).returning().get();
}

function auditTypes(db: TestDb): string[] {
  return db.select().from(auditLog).all().map((row) => row.type);
}

/** Больничный со сменой и живой передачей — общий сетап всех проверок ниже. */
async function scene(db: TestDb, opts: { date?: string; start?: string } = {}) {
  const anya = person(db, "Аня");
  const igor = person(db, "Игорь");
  const sick = sickLeave(db, anya, opts.date ?? "2026-08-13");
  const work = shift(db, anya, opts.date ?? "2026-08-13", opts.start ?? "15:00");
  const [handover] = await startHandovers(deps(db), { sickEntry: sick, employeeId: anya });
  return { anya, igor, sick, work, handover: handover! };
}

beforeEach(() => {
  sent = [];
});

describe("handover tick", () => {
  it("fans out a handover nobody answered in three hours", async () => {
    const db = makeTestDb();
    const { igor, handover } = await scene(db);
    updateHandover(db, handover.id, { offeredAt: new Date(NOW - 4 * HOUR) });
    sent = [];

    const touched = await runHandoverTick(deps(db), NOW);

    expect(touched).toBe(1);
    expect(getHandover(db, handover.id)?.status).toBe("fanned");
    expect(sent.map((m) => m.to)).toEqual([`employee:${igor}`]);
  });

  it("leaves a handover that has been silent for less than three hours", async () => {
    const db = makeTestDb();
    const { handover } = await scene(db);
    updateHandover(db, handover.id, { offeredAt: new Date(NOW - 2 * HOUR) });
    sent = [];

    expect(await runHandoverTick(deps(db), NOW)).toBe(0);
    expect(getHandover(db, handover.id)?.status).toBe("offered");
    expect(sent).toEqual([]);
  });

  it("writes to the admins once, not on every tick", async () => {
    const db = makeTestDb();
    // Смена сегодня в 15:00 — до неё девять часов, окно эскалации открыто.
    const { handover, igor } = await scene(db, { date: "2026-08-12" });
    await offerTo(deps(db), handover.id, igor);
    sent = [];

    await runHandoverTick(deps(db), NOW);
    await runHandoverTick(deps(db), NOW + 5 * 60 * 1000);

    expect(sent.filter((m) => m.to === "admins")).toHaveLength(1);
    expect(auditTypes(db).filter((t) => t === "handover_escalated")).toHaveLength(1);
  });

  it("эскалация, не дошедшая ни до одного админа (обрыв сети), повторяется следующим тиком", async () => {
    // Отметка стояла до отправки: при обрыве админы не узнавали ничего, а
    // потом `expireHandover` молчал, «потому что админы уже знают».
    const db = makeTestDb();
    const { handover, igor } = await scene(db, { date: "2026-08-12" });
    await offerTo(deps(db), handover.id, igor);
    let networkUp = false;
    const flaky = {
      ...deps(db),
      messenger: {
        ...deps(db).messenger,
        adminsAlways: async (text: string) => {
          if (!networkUp) return { attempted: 1, delivered: 0 };
          sent.push({ to: "admins", text });
          return { attempted: 1, delivered: 1 };
        },
      },
    };
    sent = [];

    await runHandoverTick(flaky, NOW);
    networkUp = true;
    await runHandoverTick(flaky, NOW + 5 * 60 * 1000);

    expect(sent.filter((m) => m.to === "admins")).toHaveLength(1);
  });

  it("does both when both are due, and the fan-out goes first", async () => {
    const db = makeTestDb();
    // «Сейчас» — 09:00 по команде, смена сегодня в 11:00: до неё два часа, то
    // есть просрочено и молчание (три часа), и окно эскалации (двенадцать).
    const { handover, igor } = await scene(db, { date: "2026-08-12", start: "11:00" });
    await offerTo(deps(db), handover.id, igor);
    updateHandover(db, handover.id, { offeredAt: new Date(NOW - 2 * HOUR) });
    sent = [];

    await runHandoverTick(deps(db), NOW);

    const after = getHandover(db, handover.id);
    expect(after?.status).toBe("fanned");
    expect(after?.escalatedAt).not.toBeNull();
    const types = auditTypes(db);
    expect(types.indexOf("handover_fanned")).toBeLessThan(types.lastIndexOf("handover_escalated"));
  });

  it("expires a handover whose shift has started, and says nothing to anyone", async () => {
    const db = makeTestDb();
    const { handover } = await scene(db, { date: "2026-08-12", start: "05:00" });
    sent = [];

    await runHandoverTick(deps(db), NOW);

    expect(getHandover(db, handover.id)?.status).toBe("expired");
    // Админам писали на эскалации; второе письмо о том же ничего не добавляет.
    expect(sent).toEqual([]);
  });

  it("невзятая смена после начала снимается с больной — «Не назначено», строка в журнале", async () => {
    // Решение владельца от 2026-09-28: иначе больная числится отработавшей, а
    // в сетке нет дыры, которую админ ищет глазами.
    const db = makeTestDb();
    const { work, handover } = await scene(db, { date: "2026-08-12", start: "05:00" });

    await runHandoverTick(deps(db), NOW);

    expect(getHandover(db, handover.id)?.status).toBe("expired");
    expect(getShift(db, work.id)?.employeeId).toBeNull();
    expect(auditTypes(db)).toContain("handover_unassigned");
  });

  it("многодневную запись не снимает — неделя без человека хуже одного пропущенного дня", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    person(db, "Игорь");
    const week = db.insert(shifts).values({
      date: "2026-08-10", endDate: "2026-08-16", start: "07:00", end: "16:00", category: "duty", employeeId: anya,
    }).returning().get();
    const sick = db.insert(shifts).values({ date: "2026-08-12", endDate: "2026-08-12", category: "sick_leave", employeeId: anya }).returning().get();
    const [handover] = await startHandovers({ ...deps(db), now: () => Date.UTC(2026, 7, 9, 12, 0) }, { sickEntry: sick, employeeId: anya });

    await runHandoverTick(deps(db), NOW);

    expect(getHandover(db, handover!.id)?.status).toBe("expired");
    expect(getShift(db, week.id)?.employeeId).toBe(anya);
  });

  it("leaves resolved handovers alone", async () => {
    const db = makeTestDb();
    const { handover } = await scene(db);
    updateHandover(db, handover.id, { status: "taken", offeredAt: new Date(NOW - 10 * HOUR) });

    expect(await runHandoverTick(deps(db), NOW)).toBe(0);
    expect(getHandover(db, handover.id)?.status).toBe("taken");
  });

  it("kills a handover whose shift an admin deleted instead of throwing", async () => {
    // Смены больше нет — тик обязан погасить передачу и идти дальше, а не
    // упасть на undefined и утащить за собой всех остальных.
    const db = makeTestDb();
    const { handover, work } = await scene(db);
    updateHandover(db, handover.id, { shiftId: null });

    expect(await runHandoverTick(deps(db), NOW)).toBe(1);
    // «cancelled», а не «expired»: смену не «никто не взял» — её не стало.
    expect(getHandover(db, handover.id)?.status).toBe("cancelled");
    expect(work.id).toBeGreaterThan(0);
  });

  it("one broken handover does not silence the rest", async () => {
    // Тот же урок, что выучил тик напоминаний: одна упавшая запись не повод
    // оставить двадцать человек без письма.
    const db = makeTestDb();
    const first = await scene(db);
    const anya2 = person(db, "Марк");
    const sick2 = sickLeave(db, anya2, "2026-08-13");
    const work2 = shift(db, anya2, "2026-08-13", "09:00", "18:00");
    const [second] = await startHandovers(deps(db), { sickEntry: sick2, employeeId: anya2 });
    updateHandover(db, first.handover.id, { shiftId: null, offeredAt: new Date(NOW - 4 * HOUR) });
    updateHandover(db, second!.id, { offeredAt: new Date(NOW - 4 * HOUR) });
    sent = [];

    await runHandoverTick(deps(db), NOW);

    expect(getHandover(db, second!.id)?.status).toBe("fanned");
    expect(work2.id).toBeGreaterThan(0);
  });
});

describe("передача гаснет сама, когда смена ушла от дающего", () => {
  // Путей, меняющих смену, восемь (правка и удаление админом, диапазон,
  // обмен в API и в боте, архивация, выходные, импорт). Правило живёт у самой
  // передачи, чтобы девятый путь не мог его забыть.

  it("админ отдал смену Марку — передача погашена, Игорю, которого спросили, «отбой», Марку ничего", async () => {
    const db = makeTestDb();
    const { igor, work, handover } = await scene(db);
    const mark = person(db, "Марк");
    await offerTo(deps(db), handover.id, igor);
    updateShift(db, work.id, { employeeId: mark });
    sent = [];

    expect(await runHandoverTick(deps(db), NOW)).toBe(1);

    expect(getHandover(db, handover.id)?.status).toBe("cancelled");
    expect(auditTypes(db)).toContain("handover_cancelled");
    expect(sent.map((m) => m.to)).toEqual([`employee:${igor}`]);
  });

  it("админ поставил смену тому самому Игорю, которому её предложили, — Игорю «отбоя» нет", async () => {
    // Найдено проверяющим: «выходить не нужно» уходило новому хозяину смены.
    const db = makeTestDb();
    const { igor, work, handover } = await scene(db);
    await offerTo(deps(db), handover.id, igor);
    updateShift(db, work.id, { employeeId: igor });
    sent = [];

    await runHandoverTick(deps(db), NOW);

    expect(getHandover(db, handover.id)?.status).toBe("cancelled");
    expect(sent).toEqual([]);
  });

  it("при переназначении «отбой» не говорит, что сняли больничный — его не снимали", async () => {
    const db = makeTestDb();
    const { igor, work, handover } = await scene(db);
    const mark = person(db, "Марк");
    await offerTo(deps(db), handover.id, igor);
    updateShift(db, work.id, { employeeId: mark });
    sent = [];

    await runHandoverTick(deps(db), NOW);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).not.toContain("больничный");
    expect(sent[0]!.text).toContain("Смену выходить не нужно");
  });

  it("смену переназначили и вернули больной — передача жива", async () => {
    const db = makeTestDb();
    const { anya, work, handover } = await scene(db);
    const mark = person(db, "Марк");
    updateShift(db, work.id, { employeeId: mark });
    updateShift(db, work.id, { employeeId: anya });
    sent = [];

    await runHandoverTick(deps(db), NOW);

    expect(getHandover(db, handover.id)?.status).toBe("offered");
  });

  it("больничный укоротили — передача на снятый день погашена, веер получил «отбой»", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const sick = db.insert(shifts).values({ date: "2026-08-13", endDate: "2026-08-14", category: "sick_leave", employeeId: anya }).returning().get();
    shift(db, anya, "2026-08-13");
    shift(db, anya, "2026-08-14");
    const [first, second] = await startHandovers(deps(db), { sickEntry: sick, employeeId: anya });
    updateHandover(db, second!.id, { status: "fanned" });
    updateShift(db, sick.id, { endDate: "2026-08-13" });
    sent = [];

    await runHandoverTick(deps(db), NOW);

    // Граница `endDate` — ещё больничный: 13-е живо.
    expect(getHandover(db, first!.id)?.status).toBe("offered");
    expect(getHandover(db, second!.id)?.status).toBe("cancelled");
    expect(sent.map((m) => m.to)).toEqual([`employee:${igor}`]);
  });

  it("больничный удалили — передача погашена", async () => {
    const db = makeTestDb();
    const { sick, handover } = await scene(db);
    deleteShift(db, sick.id);
    sent = [];

    await runHandoverTick(deps(db), NOW);

    expect(getHandover(db, handover.id)?.status).toBe("cancelled");
  });

  it("взятую передачу не трогает ничто — у смены законный хозяин", async () => {
    const db = makeTestDb();
    const { sick, work, handover } = await scene(db);
    const mark = person(db, "Марк");
    updateHandover(db, handover.id, { status: "taken" });
    updateShift(db, work.id, { employeeId: mark });
    deleteShift(db, sick.id);

    expect(await runHandoverTick(deps(db), NOW)).toBe(0);
    expect(getHandover(db, handover.id)?.status).toBe("taken");
  });
});

describe("многодневная запись и больничный посреди неё", () => {
  it("дежурство пн–вс, больничный со среды — передача жива (промежутки пересекаются)", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    person(db, "Игорь");
    db.insert(shifts).values({
      date: "2026-08-10", endDate: "2026-08-16", start: "07:00", end: "16:00", category: "duty", employeeId: anya,
    }).run();
    const sick = db.insert(shifts).values({ date: "2026-08-12", endDate: "2026-08-12", category: "sick_leave", employeeId: anya }).returning().get();
    const [handover] = await startHandovers(deps(db), { sickEntry: sick, employeeId: anya });

    expect(handoverVoidReason(db, getHandover(db, handover!.id)!)).toBeNull();
  });
});

describe("urgent branch: a sick leave still waiting for «ОК»", () => {
  function pendingSick(db: TestDb, employeeId: number, date: string, endDate: string, approved?: { date: string; endDate: string }): Shift {
    return db
      .insert(shifts)
      .values({
        date,
        endDate,
        category: "sick_leave",
        employeeId,
        approvalRequestedAt: new Date(NOW - HOUR),
        approvedDate: approved?.date ?? null,
        approvedEndDate: approved?.endDate ?? null,
      })
      .returning()
      .get();
  }

  it("hands over only the shift inside the escalation window, marks it, and the sick leave keeps waiting", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    person(db, "Игорь");
    const sick = pendingSick(db, anya, "2026-08-12", "2026-08-13");
    const soon = shift(db, anya, "2026-08-12", "15:00"); // 6 h away
    const later = shift(db, anya, "2026-08-13", "15:00"); // 30 h away

    await runHandoverTick(deps(db), NOW);

    const handed = listHandoversForEntry(db, sick.id).map((h) => h.shiftId);
    expect(handed).toEqual([soon.id]);
    expect(handed).not.toContain(later.id);
    const after = getShift(db, sick.id)!;
    expect(after.handoverForcedAt?.getTime()).toBe(Math.floor(NOW / 1000) * 1000);
    expect(after.approvalRequestedAt).not.toBeNull();
  });

  it("fans the urgent hand-over out to the colleagues at once, without waiting for the worker", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const sick = pendingSick(db, anya, "2026-08-12", "2026-08-12");
    shift(db, anya, "2026-08-12", "15:00");

    await runHandoverTick(deps(db), NOW);

    expect(listHandoversForEntry(db, sick.id).map((h) => h.status)).toEqual(["fanned"]);
    expect(sent.some((m) => m.to === `employee:${igor}`)).toBe(true);
  });

  it("a second tick creates nothing, sends nothing and keeps the first mark", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    person(db, "Игорь");
    const sick = pendingSick(db, anya, "2026-08-12", "2026-08-12");
    shift(db, anya, "2026-08-12", "15:00");
    await runHandoverTick(deps(db), NOW);
    const mark = getShift(db, sick.id)!.handoverForcedAt;
    const sentAfterFirst = sent.length;

    await runHandoverTick(deps(db), NOW + 5 * 60 * 1000);

    expect(listHandoversForEntry(db, sick.id)).toHaveLength(1);
    expect(sent.length).toBe(sentAfterFirst);
    expect(getShift(db, sick.id)!.handoverForcedAt).toEqual(mark);
  });

  it("an approved sick leave and an observer's pending one are left to their usual paths", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const dasha = db.insert(employees).values({ displayName: "Даша", isObserver: true }).returning().get().id;
    person(db, "Игорь");
    const approved = sickLeave(db, anya, "2026-08-12");
    shift(db, anya, "2026-08-12", "15:00");
    const observers = pendingSick(db, dasha, "2026-08-12", "2026-08-12");
    shift(db, dasha, "2026-08-12", "15:00");
    await runHandoverTick(deps(db), NOW);
    expect(listHandoversForEntry(db, approved.id)).toHaveLength(0);
    expect(listHandoversForEntry(db, observers.id)).toHaveLength(0);
  });

  it("the window follows the TEAM date: 00:30 in Moscow on the 13th is still the 12th in UTC", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    person(db, "Игорь");
    const sick = pendingSick(db, anya, "2026-08-13", "2026-08-13");
    const early = shift(db, anya, "2026-08-13", "01:00", "09:00");
    const night = Date.UTC(2026, 7, 12, 21, 30);
    const narrow = { ...deps(db), config: { ...deps(db).config, handoverEscalateHours: 1 } };

    await runHandoverTick(narrow, night);

    expect(listHandoversForEntry(db, sick.id).map((h) => h.shiftId)).toEqual([early.id]);
  });

  it("a shift that has already started is not handed over", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    person(db, "Игорь");
    const sick = pendingSick(db, anya, "2026-08-12", "2026-08-12");
    shift(db, anya, "2026-08-12", "08:00"); // started an hour before NOW

    await runHandoverTick(deps(db), NOW);

    expect(listHandoversForEntry(db, sick.id)).toHaveLength(0);
    expect(getShift(db, sick.id)!.handoverForcedAt).toBeNull();
  });

  it("a pending EXTENSION hands over only shifts on its new days, never the approved ones", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    person(db, "Игорь");
    // 12th is approved, 13th is what waits; a wide window puts both shifts inside it.
    const sick = pendingSick(db, anya, "2026-08-12", "2026-08-13", { date: "2026-08-12", endDate: "2026-08-12" });
    const approvedDay = shift(db, anya, "2026-08-12", "15:00");
    const newDay = shift(db, anya, "2026-08-13", "15:00");
    const wide = { ...deps(db), config: { ...deps(db).config, handoverEscalateHours: 40 } };

    await runHandoverTick(wide, NOW);

    const handed = listHandoversForEntry(db, sick.id).map((h) => h.shiftId);
    expect(handed).toEqual([newDay.id]);
    expect(handed).not.toContain(approvedDay.id);
  });
});

describe("after an «ОК»: drafts wait for the worker, then the existing timer takes over", () => {
  it("an approved sick leave's draft is NOT fanned at once; silence past `handoverFanHours` fans it as today", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const boss = person(db, "Марк");
    const sick = db
      .insert(shifts)
      .values({ date: "2026-08-13", endDate: "2026-08-13", category: "sick_leave", employeeId: anya, approvalRequestedAt: new Date(NOW - 2 * HOUR) })
      .returning()
      .get();
    shift(db, anya, "2026-08-13", "15:00"); // 30 h after NOW: outside the escalation window
    // The fixtures live in August 2026, so the service gets this file's clock, not the wall clock.
    const approvalDeps = { ...sickApprovalDeps(null, db, deps(db).config), now: deps(db).now, messenger: deps(db).messenger };

    await approveSickLeave(approvalDeps, sick.id, boss);
    const [draft] = listHandoversForEntry(db, sick.id);
    expect([draft!.status, draft!.offeredToEmployeeId]).toEqual(["offered", null]);
    expect(sent.filter((m) => m.to === `employee:${igor}`)).toHaveLength(0);

    // The worker never opened the button: three hours of silence, as for any draft today.
    updateHandover(db, draft!.id, { offeredAt: new Date(NOW - 4 * HOUR) });
    await runHandoverTick(deps(db), NOW);

    expect(getHandover(db, draft!.id)!.status).toBe("fanned");
    expect(sent.some((m) => m.to === `employee:${igor}`)).toBe(true);
  });
});
