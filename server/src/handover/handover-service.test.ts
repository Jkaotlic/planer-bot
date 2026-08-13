import { describe, it, expect, beforeEach } from "vitest";
import { makeTestDb } from "../db/testdb";
import { employees, shifts, auditLog, type Shift } from "../db/schema";
import { getShift } from "../repo/shifts";
import { getHandover, listDeclines, listHandoversForEntry } from "../repo/handovers";
import { startHandovers, offerTo, fanOut, declineHandover, takeHandover, cancelHandoversForEntry } from "./handover-service";
import type { Db } from "../db/client";

const CONFIG = { teamTz: "Europe/Moscow" } as const;

/** Every message that would have gone to Telegram, without a bot at all. */
let sent: { to: string; text: string }[] = [];

/**
 * The messenger is an interface rather than a `Bot`, so a test can see WHO was
 * written to — not merely that something was sent. A message reaching the wrong
 * person is the most expensive defect this feature can have, and a check on
 * «ушло N сообщений» is blind to exactly that.
 */
function deps(db: Db) {
  return {
    db,
    config: CONFIG,
    messenger: {
      offer: async (employeeId: number, _handoverId: number, text: string) => {
        sent.push({ to: `employee:${employeeId}`, text });
      },
      fan: async (employeeIds: readonly number[], _handoverId: number, text: string) => {
        for (const id of employeeIds) sent.push({ to: `employee:${id}`, text });
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
  return db.insert(employees).values({ displayName, telegramUserId: null }).returning().get().id;
}

function shift(db: TestDb, employeeId: number, date: string, start = "09:00", end = "18:00"): Shift {
  return db.insert(shifts).values({ date, start, end, category: "shift", title: "День", employeeId }).returning().get();
}

function sickLeave(db: TestDb, employeeId: number, date: string, endDate: string): Shift {
  return db.insert(shifts).values({ date, endDate, category: "sick_leave", employeeId }).returning().get();
}

function auditTypes(db: TestDb): string[] {
  return db.select().from(auditLog).all().map((row) => row.type);
}

beforeEach(() => {
  sent = [];
});

describe("starting handovers for a sick leave", () => {
  it("makes one per shift the sick leave covers", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    person(db, "Игорь");
    const sick = sickLeave(db, anya, "2026-08-12", "2026-08-14");
    const first = shift(db, anya, "2026-08-12");
    const second = shift(db, anya, "2026-08-13");

    const made = await startHandovers(deps(db), { sickEntry: sick, employeeId: anya });

    expect(made).toHaveLength(2);
    expect(made.map((h) => h.shiftId).sort()).toEqual([first.id, second.id].sort());
    expect(listHandoversForEntry(db, sick.id)).toHaveLength(2);
  });

  it("makes none when those days hold no shifts", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    person(db, "Игорь");
    const sick = sickLeave(db, anya, "2026-08-12", "2026-08-14");
    expect(await startHandovers(deps(db), { sickEntry: sick, employeeId: anya })).toEqual([]);
  });

  it("does not offer the sick leave itself", async () => {
    // Больничный сам лежит в тех же днях — предложить его коллеге было бы
    // буквально «возьми мою болезнь».
    const db = makeTestDb();
    const anya = person(db, "Аня");
    person(db, "Игорь");
    const sick = sickLeave(db, anya, "2026-08-12", "2026-08-12");
    expect(await startHandovers(deps(db), { sickEntry: sick, employeeId: anya })).toEqual([]);
  });

  it("escalates at birth when nobody is free", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const sick = sickLeave(db, anya, "2026-08-12", "2026-08-12");
    shift(db, anya, "2026-08-12");
    shift(db, igor, "2026-08-12");

    const [handover] = await startHandovers(deps(db), { sickEntry: sick, employeeId: anya });

    expect(handover!.status).toBe("fanned");
    expect(handover!.escalatedAt).not.toBeNull();
    expect(auditTypes(db)).toContain("handover_escalated");
  });
});

describe("offering to one colleague", () => {
  it("remembers the addressee and writes to them", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const sick = sickLeave(db, anya, "2026-08-12", "2026-08-12");
    const work = shift(db, anya, "2026-08-12");
    const [handover] = await startHandovers(deps(db), { sickEntry: sick, employeeId: anya });

    await offerTo(deps(db), handover!.id, igor);

    const after = getHandover(db, handover!.id);
    expect(after?.status).toBe("offered");
    expect(after?.offeredToEmployeeId).toBe(igor);
    expect(auditTypes(db)).toContain("handover_offered");
    expect(work.id).toBe(after?.shiftId);
  });
});

describe("going straight to the fan-out", () => {
  it("asks everybody free at once — this is what «Потом» does", async () => {
    // Пропуск выбора не должен означать «смена тихо осталась на больном».
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const mark = person(db, "Марк");
    const sick = sickLeave(db, anya, "2026-08-12", "2026-08-12");
    shift(db, anya, "2026-08-12");
    const [handover] = await startHandovers(deps(db), { sickEntry: sick, employeeId: anya });
    sent = [];

    await fanOut(deps(db), handover!.id);

    expect(getHandover(db, handover!.id)?.status).toBe("fanned");
    expect(getHandover(db, handover!.id)?.offeredToEmployeeId).toBeNull();
    expect(sent.map((m) => m.to).sort()).toEqual([`employee:${igor}`, `employee:${mark}`].sort());
    expect(auditTypes(db)).toContain("handover_fanned");
  });

  it("skips those who already said no", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const mark = person(db, "Марк");
    const sick = sickLeave(db, anya, "2026-08-12", "2026-08-12");
    shift(db, anya, "2026-08-12");
    const [handover] = await startHandovers(deps(db), { sickEntry: sick, employeeId: anya });
    await offerTo(deps(db), handover!.id, igor);
    await declineHandover(deps(db), handover!.id, igor);
    sent = [];

    await fanOut(deps(db), handover!.id);

    expect(sent.map((m) => m.to)).toEqual([`employee:${mark}`]);
  });
});

describe("declining", () => {
  it("records the refusal and fans out immediately", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    person(db, "Марк");
    const sick = sickLeave(db, anya, "2026-08-12", "2026-08-12");
    shift(db, anya, "2026-08-12");
    const [handover] = await startHandovers(deps(db), { sickEntry: sick, employeeId: anya });
    await offerTo(deps(db), handover!.id, igor);

    const result = await declineHandover(deps(db), handover!.id, igor);

    expect(result.ok).toBe(true);
    expect(getHandover(db, handover!.id)?.status).toBe("fanned");
    expect(listDeclines(db, handover!.id)).toEqual([igor]);
    expect(auditTypes(db)).toContain("handover_declined");
  });

  it("does not write to the person who just refused", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const mark = person(db, "Марк");
    const sick = sickLeave(db, anya, "2026-08-12", "2026-08-12");
    shift(db, anya, "2026-08-12");
    const [handover] = await startHandovers(deps(db), { sickEntry: sick, employeeId: anya });
    await offerTo(deps(db), handover!.id, igor);
    sent = [];

    await declineHandover(deps(db), handover!.id, igor);

    expect(sent.map((m) => m.to)).toEqual([`employee:${mark}`]);
  });

  it("refuses a decline on a handover that is already resolved", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const sick = sickLeave(db, anya, "2026-08-12", "2026-08-12");
    shift(db, anya, "2026-08-12");
    const [handover] = await startHandovers(deps(db), { sickEntry: sick, employeeId: anya });
    await takeHandover(deps(db), handover!.id, igor);

    expect((await declineHandover(deps(db), handover!.id, igor)).ok).toBe(false);
  });
});

describe("taking a shift", () => {
  it("moves the entry to the taker and closes the handover", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const sick = sickLeave(db, anya, "2026-08-12", "2026-08-12");
    const work = shift(db, anya, "2026-08-12");
    const [handover] = await startHandovers(deps(db), { sickEntry: sick, employeeId: anya });

    const result = await takeHandover(deps(db), handover!.id, igor);

    expect(result.ok).toBe(true);
    expect(getShift(db, work.id)?.employeeId).toBe(igor);
    const after = getHandover(db, handover!.id);
    expect(after?.status).toBe("taken");
    expect(after?.takenByEmployeeId).toBe(igor);
    expect(after?.resolvedAt).not.toBeNull();
    expect(auditTypes(db)).toContain("handover_taken");
  });

  it("gives the shift to exactly one of two simultaneous takers", async () => {
    // Тот класс, что дважды спамил команду: гонка живёт там, где статус
    // пишется ПОСЛЕ await. Захват обязан завершиться до первой отправки.
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const mark = person(db, "Марк");
    const sick = sickLeave(db, anya, "2026-08-12", "2026-08-12");
    const work = shift(db, anya, "2026-08-12");
    const [handover] = await startHandovers(deps(db), { sickEntry: sick, employeeId: anya });

    const [first, second] = await Promise.all([
      takeHandover(deps(db), handover!.id, igor),
      takeHandover(deps(db), handover!.id, mark),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect([igor, mark]).toContain(getShift(db, work.id)?.employeeId);
    expect(auditTypes(db).filter((t) => t === "handover_taken")).toHaveLength(1);
  });

  it("refuses somebody who has picked up their own shift meanwhile", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const sick = sickLeave(db, anya, "2026-08-12", "2026-08-12");
    const work = shift(db, anya, "2026-08-12", "09:00", "18:00");
    const [handover] = await startHandovers(deps(db), { sickEntry: sick, employeeId: anya });
    // Три часа спустя Игорю поставили свою смену на те же часы.
    shift(db, igor, "2026-08-12", "12:00", "20:00");

    const result = await takeHandover(deps(db), handover!.id, igor);

    expect(result.ok).toBe(false);
    expect(getShift(db, work.id)?.employeeId).toBe(anya);
  });

  it("refuses a handover that is no longer open, whatever closed it", async () => {
    for (const closer of ["taken", "cancelled"] as const) {
      const db = makeTestDb();
      const anya = person(db, "Аня");
      const igor = person(db, "Игорь");
      const mark = person(db, "Марк");
      const sick = sickLeave(db, anya, "2026-08-12", "2026-08-12");
      const work = shift(db, anya, "2026-08-12");
      const [handover] = await startHandovers(deps(db), { sickEntry: sick, employeeId: anya });
      if (closer === "taken") await takeHandover(deps(db), handover!.id, igor);
      else await cancelHandoversForEntry(deps(db), sick.id, []);

      const result = await takeHandover(deps(db), handover!.id, mark);

      expect(result.ok, closer).toBe(false);
      expect(getShift(db, work.id)?.employeeId, closer).not.toBe(mark);
    }
  });
});

describe("cancelling", () => {
  it("kills the handovers a removed sick leave spawned and tells the people asked", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const sick = sickLeave(db, anya, "2026-08-12", "2026-08-13");
    shift(db, anya, "2026-08-12");
    shift(db, anya, "2026-08-13");
    const made = await startHandovers(deps(db), { sickEntry: sick, employeeId: anya });
    await offerTo(deps(db), made[0]!.id, igor);
    sent = [];

    const killed = await cancelHandoversForEntry(deps(db), sick.id, []);

    expect(killed).toBe(2);
    for (const handover of made) expect(getHandover(db, handover.id)?.status).toBe("cancelled");
    expect(sent.map((m) => m.to)).toContain(`employee:${igor}`);
    expect(auditTypes(db).filter((t) => t === "handover_cancelled")).toHaveLength(2);
  });

  it("keeps the days a shortened sick leave still covers", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    person(db, "Игорь");
    const sick = sickLeave(db, anya, "2026-08-12", "2026-08-14");
    const stays = shift(db, anya, "2026-08-12");
    const goes = shift(db, anya, "2026-08-14");
    await startHandovers(deps(db), { sickEntry: sick, employeeId: anya });

    // Больничный укорочен до 12–13: 14-е больше не покрыто.
    const killed = await cancelHandoversForEntry(deps(db), sick.id, ["2026-08-12", "2026-08-13"]);

    expect(killed).toBe(1);
    const rows = listHandoversForEntry(db, sick.id);
    expect(rows.find((h) => h.shiftId === goes.id)?.status).toBe("cancelled");
    expect(rows.find((h) => h.shiftId === stays.id)?.status).not.toBe("cancelled");
  });

  it("leaves an already taken handover alone — that shift has an owner now", async () => {
    // Погасить взятую передачу значило бы сказать Игорю «не выходи», когда
    // смена уже на нём и в графике.
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const sick = sickLeave(db, anya, "2026-08-12", "2026-08-12");
    const work = shift(db, anya, "2026-08-12");
    const [handover] = await startHandovers(deps(db), { sickEntry: sick, employeeId: anya });
    await takeHandover(deps(db), handover!.id, igor);

    await cancelHandoversForEntry(deps(db), sick.id, []);

    expect(getHandover(db, handover!.id)?.status).toBe("taken");
    expect(getShift(db, work.id)?.employeeId).toBe(igor);
  });
});
