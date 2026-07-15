import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../db/testdb";
import { seedDefaultTemplates } from "../db/seed";
import { employees } from "../db/schema";
import { createEmployee, linkTelegramAccount, getByTelegramId, listActive } from "./employees";
import { listActiveTemplates } from "./templates";
import { createShift, getShift, listShiftsInRange, listUpcomingForEmployee } from "./shifts";

describe("repository", () => {
  it("creates and links an employee by invite token", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "tok-123" });
    expect(getByTelegramId(db, 555)).toBeUndefined();

    const linked = linkTelegramAccount(db, "tok-123", 555, "anya");
    expect(linked?.id).toBe(anya.id);
    expect(linked?.telegramUserId).toBe(555);
    expect(linked?.inviteToken).toBeNull();
    expect(getByTelegramId(db, 555)?.displayName).toBe("Аня");

    // token is single-use
    expect(linkTelegramAccount(db, "tok-123", 999)).toBeNull();
  });

  it("lists active employees only", () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });
    expect(listActive(db).map((e) => e.displayName).sort()).toEqual(["Аня", "Игорь"]);
    expect(igor.isActive).toBe(true);
  });

  it("excludes an inactive employee from listActive", () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });
    db.update(employees).set({ isActive: false }).where(eq(employees.id, igor.id)).run();
    expect(listActive(db).map((e) => e.displayName)).toEqual(["Аня"]);
  });

  it("reads seeded templates in order", () => {
    const db = makeTestDb();
    seedDefaultTemplates(db);
    expect(listActiveTemplates(db).map((t) => t.name)).toEqual(["Утро", "День", "Вечер", "Ночь", "Дежурство · Поклонка"]);
  });

  it("creates shifts and queries by range and by employee", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const s1 = createShift(db, { date: "2026-07-01", start: "08:00", end: "17:00", employeeId: anya.id });
    createShift(db, { date: "2026-07-06", start: "11:00", end: "20:00", employeeId: anya.id });
    createShift(db, { date: "2026-07-20", start: "09:00", end: "18:00", employeeId: anya.id });

    expect(getShift(db, s1.id)?.date).toBe("2026-07-01");
    expect(listShiftsInRange(db, "2026-07-01", "2026-07-07").map((s) => s.date)).toEqual(["2026-07-01", "2026-07-06"]);
    expect(listUpcomingForEmployee(db, anya.id, "2026-07-05").map((s) => s.date)).toEqual(["2026-07-06", "2026-07-20"]);
  });

  it("listUpcomingForEmployee returns only the target employee's shifts", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });
    createShift(db, { date: "2026-07-15", start: "08:00", end: "17:00", employeeId: anya.id });
    createShift(db, { date: "2026-07-16", start: "09:00", end: "18:00", employeeId: igor.id });

    const result = listUpcomingForEmployee(db, anya.id, "2026-07-01");
    expect(result).toHaveLength(1);
    expect(result[0]?.employeeId).toBe(anya.id);
    expect(result[0]?.date).toBe("2026-07-15");
  });
});
