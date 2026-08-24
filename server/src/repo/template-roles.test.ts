import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, archiveEmployee, setEmployeeRestrictions } from "./employees";
import { listActiveTemplates } from "./templates";
import { createShift } from "./shifts";
import {
  getTemplateRoles,
  getAllTemplateRoles,
  setTemplateRoles,
  rotationCandidatesFor,
  UnknownEmployeesError,
} from "./template-roles";
import type { Db } from "../db/client";

/** Migration 0006 seeds all eight presets, so these are real ids. */
const presetId = (db: Db, name: string) => listActiveTemplates(db).find((t) => t.name === name)!.id;

describe("getTemplateRoles", () => {
  it("reads an unconfigured preset as «everyone, nobody asked»", () => {
    const db = makeTestDb();
    expect(getTemplateRoles(db, presetId(db, "Ночь"))).toEqual({ pool: [], preference: {} });
  });
});

describe("setTemplateRoles", () => {
  it("stores who may take a preset and who asked for it", () => {
    const db = makeTestDb();
    const pokl = presetId(db, "Дежурство · Поклонка");
    const a = createEmployee(db, { displayName: "Первый" }).id;
    const b = createEmployee(db, { displayName: "Второй" }).id;

    setTemplateRoles(db, pokl, { pool: [a, b], preference: { [b]: 3 } });
    expect(getTemplateRoles(db, pokl)).toEqual({ pool: [a, b], preference: { [b]: 3 } });
  });

  it("replaces rather than adds — the editor always sends the whole picture", () => {
    const db = makeTestDb();
    const night = presetId(db, "Ночь");
    const a = createEmployee(db, { displayName: "Первый" }).id;
    const b = createEmployee(db, { displayName: "Второй" }).id;

    setTemplateRoles(db, night, { pool: [a, b], preference: { [a]: 1 } });
    setTemplateRoles(db, night, { pool: [b], preference: {} });
    expect(getTemplateRoles(db, night)).toEqual({ pool: [b], preference: {} });
  });

  it("drops a duplicate id instead of tripping the unique index", () => {
    const db = makeTestDb();
    const night = presetId(db, "Ночь");
    const a = createEmployee(db, { displayName: "Первый" }).id;
    expect(setTemplateRoles(db, night, { pool: [a, a], preference: {} }).pool).toEqual([a]);
  });

  it("treats weight 0 as «no longer asked for it»", () => {
    const db = makeTestDb();
    const night = presetId(db, "Ночь");
    const a = createEmployee(db, { displayName: "Первый" }).id;
    setTemplateRoles(db, night, { pool: [], preference: { [a]: 0 } });
    expect(getTemplateRoles(db, night).preference).toEqual({});
  });

  it("refuses an archived or unknown worker, and writes nothing", () => {
    const db = makeTestDb();
    const night = presetId(db, "Ночь");
    const a = createEmployee(db, { displayName: "Первый" }).id;
    const gone = createEmployee(db, { displayName: "Уволенный" }).id;
    archiveEmployee(db, gone, "2026-06-01");
    setTemplateRoles(db, night, { pool: [a], preference: {} });

    expect(() => setTemplateRoles(db, night, { pool: [a, gone], preference: {} })).toThrow(UnknownEmployeesError);
    expect(() => setTemplateRoles(db, night, { pool: [a, 9999], preference: {} })).toThrow(/9999/);
    // The pool that was already there survived both refusals.
    expect(getTemplateRoles(db, night).pool).toEqual([a]);
  });

  it("clears a preset back to «everyone»", () => {
    const db = makeTestDb();
    const night = presetId(db, "Ночь");
    const a = createEmployee(db, { displayName: "Первый" }).id;
    setTemplateRoles(db, night, { pool: [a], preference: { [a]: 2 } });
    setTemplateRoles(db, night, { pool: [], preference: {} });
    expect(getTemplateRoles(db, night)).toEqual({ pool: [], preference: {} });
  });
});

describe("rotationCandidatesFor", () => {
  it("сужает очередь до пула, когда пул задан", () => {
    // После снятия честной раздачи пул влияет только на эту очередь: если правило
    // отсюда пропадёт, «кому следующему дежурить» начнёт называть людей, которых
    // админ к дежурству не допускал, и заметить это будет некому.
    const db = makeTestDb();
    const night = presetId(db, "Ночь");
    const inPool = createEmployee(db, { displayName: "Игорь" }).id;
    const outside = createEmployee(db, { displayName: "Марк" }).id;

    expect(rotationCandidatesFor(db, night, "2026-08-03").map((c) => c.employeeId)).toEqual(
      expect.arrayContaining([inPool, outside]),
    );

    setTemplateRoles(db, night, { pool: [inPool], preference: {} });
    const ids = rotationCandidatesFor(db, night, "2026-08-03").map((c) => c.employeeId);
    expect(ids).toContain(inPool);
    expect(ids).not.toContain(outside);
  });

  it("ignores shifts dated after asOf when picking lastHeld — a schedule built weeks ahead", () => {
    const db = makeTestDb();
    const night = presetId(db, "Ночь");
    const a = createEmployee(db, { displayName: "Иванов" }).id;

    // The whole point: this shift is in the future relative to asOf below, so it must
    // not count as "already held" yet — the rotation hint is computed as of asOf.
    createShift(db, { date: "2026-08-15", start: "22:00", end: "06:00", category: "shift", employeeId: a, templateId: night });

    const candidates = rotationCandidatesFor(db, night, "2026-08-03");
    expect(candidates.find((c) => c.employeeId === a)?.lastHeld).toBeNull();
  });

  it("still picks up a past shift as lastHeld", () => {
    const db = makeTestDb();
    const night = presetId(db, "Ночь");
    const a = createEmployee(db, { displayName: "Петров" }).id;
    createShift(db, { date: "2026-07-01", start: "22:00", end: "06:00", category: "shift", employeeId: a, templateId: night });

    const candidates = rotationCandidatesFor(db, night, "2026-08-03");
    expect(candidates.find((c) => c.employeeId === a)?.lastHeld).toBe("2026-07-01");
  });

  // Excluded people are out of every automatic hand-out, and this queue is the
  // ★ hint on both consoles — showing them as «next up» would invite exactly the
  // assignment the flag exists to prevent.
  it("skips an excluded worker and keeps the rest", () => {
    const db = makeTestDb();
    const night = presetId(db, "Ночь");
    const igor = createEmployee(db, { displayName: "Игорь Петров" }).id;
    const anya = createEmployee(db, { displayName: "Аня Смирнова" }).id;
    setEmployeeRestrictions(db, igor, { excludedFromAssignment: true });

    const excluded = rotationCandidatesFor(db, night, "2026-08-03");
    expect(excluded.find((c) => c.employeeId === igor)).toBeUndefined();
    expect(excluded.find((c) => c.employeeId === anya)).toBeDefined();

    setEmployeeRestrictions(db, igor, { excludedFromAssignment: false });
    const cleared = rotationCandidatesFor(db, night, "2026-08-03");
    expect(cleared.find((c) => c.employeeId === igor)).toBeDefined();
  });
});

describe("getAllTemplateRoles", () => {
  it("returns one entry per configured preset and nothing for the rest", () => {
    const db = makeTestDb();
    const night = presetId(db, "Ночь");
    const pokl = presetId(db, "Дежурство · Поклонка");
    const a = createEmployee(db, { displayName: "Первый" }).id;
    const b = createEmployee(db, { displayName: "Второй" }).id;

    setTemplateRoles(db, night, { pool: [a], preference: {} });
    setTemplateRoles(db, pokl, { pool: [b], preference: { [b]: 2 } });

    const all = getAllTemplateRoles(db);
    expect([...all.keys()].sort((x, y) => x - y)).toEqual([night, pokl].sort((x, y) => x - y));
    expect(all.get(night)).toEqual({ pool: [a], preference: {} });
    expect(all.get(pokl)).toEqual({ pool: [b], preference: { [b]: 2 } });
    expect(all.get(presetId(db, "Утро"))).toBeUndefined();
  });

  it("keeps a preference from a preset with no pool", () => {
    const db = makeTestDb();
    const morning = presetId(db, "Утро");
    const a = createEmployee(db, { displayName: "Жаворонок" }).id;
    setTemplateRoles(db, morning, { pool: [], preference: { [a]: 1 } });
    expect(getAllTemplateRoles(db).get(morning)).toEqual({ pool: [], preference: { [a]: 1 } });
  });
});
