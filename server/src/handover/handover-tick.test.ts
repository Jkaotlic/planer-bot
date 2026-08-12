import { describe, it, expect, beforeEach } from "vitest";
import { makeTestDb } from "../db/testdb";
import { employees, shifts, auditLog, type Shift } from "../db/schema";
import { getHandover, updateHandover } from "../repo/handovers";
import { startHandovers, offerTo } from "./handover-service";
import { runHandoverTick } from "./handover-tick";
import type { Db } from "../db/client";

const HOUR = 60 * 60 * 1000;
/** 12 авг 2026, 09:00 по Москве — то есть 06:00 UTC. */
const NOW = Date.UTC(2026, 7, 12, 6, 0);

let sent: { to: string; text: string }[] = [];

function deps(db: Db) {
  return {
    db,
    config: { teamTz: "Europe/Moscow", handoverFanHours: 3, handoverEscalateHours: 12 },
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
    expect(getHandover(db, handover.id)?.status).toBe("expired");
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
