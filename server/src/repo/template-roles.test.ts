import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, archiveEmployee } from "./employees";
import { listActiveTemplates } from "./templates";
import {
  getTemplateRoles,
  getAllTemplateRoles,
  setTemplateRoles,
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
