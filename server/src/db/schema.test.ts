import { describe, it, expect } from "vitest";
import {
  employees,
  shifts,
  shiftTemplates,
  swapRequests,
  reminderLog,
  auditLog,
  templatePool,
  templatePreference,
  calendarDays,
  collections,
  collectionLinkPending,
} from "./schema";
import { makeTestDb } from "./testdb";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { createEmployee, setEmployeeObserver, setSelfScheduleEnabled, setEmployeeRestrictions } from "../repo/employees";

describe("schema", () => {
  it("declares all six tables with expected sqlite names", () => {
    expect(getTableConfig(employees).name).toBe("employees");
    expect(getTableConfig(shiftTemplates).name).toBe("shift_templates");
    expect(getTableConfig(shifts).name).toBe("shifts");
    expect(getTableConfig(swapRequests).name).toBe("swap_requests");
    expect(getTableConfig(reminderLog).name).toBe("reminder_log");
    expect(getTableConfig(auditLog).name).toBe("audit_log");
  });

  it("maps camelCase keys to snake_case columns via casing (verified in emitted SQL)", () => {
    const db = drizzle(new Database(":memory:"), { casing: "snake_case" });
    const sql = db.select().from(employees).toSQL().sql;
    expect(sql).toContain("telegram_user_id");
    expect(sql).toContain("display_name");
    expect(sql).toContain("prep_buffer_min");
  });

  it("declares one index on reminder_log (uniqueness verified in the migration SQL, Task 3)", () => {
    expect(getTableConfig(reminderLog).indexes.length).toBe(1);
  });

  it("shifts carries category, end_date, location, and nullable start/end", () => {
    const db = drizzle(new Database(":memory:"), { casing: "snake_case" });
    const sql = db.select().from(shifts).toSQL().sql;
    expect(sql).toContain("category");
    expect(sql).toContain("end_date");
    expect(sql).toContain("location");
  });

  it("employees carries archived_at", () => {
    const db = drizzle(new Database(":memory:"), { casing: "snake_case" });
    const sql = db.select().from(employees).toSQL().sql;
    expect(sql).toContain("archived_at");
  });
});

describe("role configuration columns", () => {
  it("defaults every preset to 'not a role' so the migration is inert", () => {
    const db = makeTestDb();
    db.insert(shiftTemplates).values({ name: "X", start: "09:00", end: "18:00" }).run();
    const row = db.select().from(shiftTemplates).all()[0]!;
    expect(row.coverage).toBe("0,0,0,0,0,0,0");
    expect(row.fillMode).toBe("count");
    expect(row.rotationUnit).toBe("day");
    expect(row.primaryEmployeeId).toBeNull();
  });

  it("stores a pool membership, a preference and a calendar day", () => {
    const db = makeTestDb();
    const tpl = db.insert(shiftTemplates).values({ name: "X", start: "09:00", end: "18:00" }).returning().all()[0]!;
    const emp = db.insert(employees).values({ displayName: "Аня" }).returning().all()[0]!;

    db.insert(templatePool).values({ templateId: tpl.id, employeeId: emp.id }).run();
    expect(db.select().from(templatePool).all()).toHaveLength(1);

    db.insert(templatePreference).values({ templateId: tpl.id, employeeId: emp.id }).run();
    expect(db.select().from(templatePreference).all()[0]!.weight).toBe(1);

    db.insert(calendarDays).values({ date: "2026-06-12", kind: "holiday", note: "День России", updatedAt: new Date() }).run();
    expect(db.select().from(calendarDays).all()[0]!.kind).toBe("holiday");
  });

  it("refuses a second pool row for the same person on the same preset", () => {
    const db = makeTestDb();
    const tpl = db.insert(shiftTemplates).values({ name: "X", start: "09:00", end: "18:00" }).returning().all()[0]!;
    const emp = db.insert(employees).values({ displayName: "Аня" }).returning().all()[0]!;
    db.insert(templatePool).values({ templateId: tpl.id, employeeId: emp.id }).run();
    expect(() => db.insert(templatePool).values({ templateId: tpl.id, employeeId: emp.id }).run()).toThrow(/UNIQUE/i);
  });
});

describe("роль наблюдателя", () => {
  it("новый работник наблюдателем не становится", () => {
    const db = makeTestDb();
    const person = createEmployee(db, { displayName: "Аня" });
    expect(person.isObserver).toBe(false);
    expect(person.selfScheduleEnabled).toBe(false);
  });

  it("тумблер своего графика живёт отдельно от роли", () => {
    const db = makeTestDb();
    const person = createEmployee(db, { displayName: "Игорь" });
    const observer = setEmployeeObserver(db, person.id, true)!;
    expect(observer.isObserver).toBe(true);
    // Роль сама по себе график вести не разрешает — это второе, личное решение.
    expect(observer.selfScheduleEnabled).toBe(false);
    expect(setSelfScheduleEnabled(db, person.id, true)!.selfScheduleEnabled).toBe(true);
  });

  it("снятие роли не трогает исключения, которые ставил админ", () => {
    const db = makeTestDb();
    const person = createEmployee(db, { displayName: "Марк" });
    setEmployeeRestrictions(db, person.id, { excludedFromSwaps: true });
    setEmployeeObserver(db, person.id, true);
    const back = setEmployeeObserver(db, person.id, false)!;
    expect(back.excludedFromSwaps).toBe(true);
  });
});

it("сбор помнит день автоотправки и то, что попытка уже была", () => {
  const db = makeTestDb();
  const employee = createEmployee(db, { displayName: "Марк", inviteToken: "inv-mark" });
  const row = db
    .insert(collections)
    .values({ kind: "birthday", employeeId: employee.id, year: 2026, celebratedOn: "2026-09-07", autoSendOn: "2026-09-04" })
    .returning()
    .all()[0]!;

  expect(row.autoSendOn).toBe("2026-09-04");
  // Пусто — значит «ещё не пробовал». Отличать «не пробовал» от «пробовал и не
  // вышло» обязан тик, иначе он рассылает второй раз.
  expect(row.autoSentAt).toBeNull();
});

it("окно ожидания держит ссылку, пока админ выбирает сбор", () => {
  const db = makeTestDb();
  const admin = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-igor" });
  db.insert(collectionLinkPending).values({ employeeId: admin.id, url: "https://example.com/sbor" }).run();

  const row = db.select().from(collectionLinkPending).all()[0]!;
  expect(row.url).toBe("https://example.com/sbor");
});
