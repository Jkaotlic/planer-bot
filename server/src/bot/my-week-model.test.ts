import { describe, expect, it } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { markApprovalRequested } from "../repo/sick-approvals";
import { buildMyWeekState, serializeMyWeekState } from "./my-week-model";

function fixture() {
  const db = makeTestDb();
  const me = createEmployee(db, { displayName: "Аня" });
  const other = createEmployee(db, { displayName: "Марк" });
  return { db, me, other };
}
describe("личные данные недели", () => {
  it("отбирает только свои записи и сохраняет ночное время, не читая заметки", () => {
    const { db, me, other } = fixture();
    createShift(db, { employeeId: me.id, date: "2026-11-10", category: "shift", title: "Ночь", start: "21:00", end: "09:00", location: "Офис", note: "Скрытая заметка" });
    createShift(db, { employeeId: other.id, date: "2026-11-10", category: "shift", title: "Чужая смена", start: "07:00", end: "16:00" });
    const state = buildMyWeekState(db, me.id, "2026-11-10", "2026-11-09", 1, 0);
    expect(state).toMatchObject({ m: "2026-11-09", t: "2026-11-10", d: 1, p: 0, n: 1, e: { title: "Ночь", time: "21:00–09:00", hint: "До следующего дня", location: "Офис" } });
    expect(state.c).toHaveLength(7);
    expect(serializeMyWeekState(state)).not.toMatch(/Скрытая|Чужая|employeeId|Марк/);
  });
  it("отпуск, начавшийся до понедельника, виден до своего конца", () => {
    const { db, me } = fixture();
    createShift(db, { employeeId: me.id, date: "2026-11-06", endDate: "2026-11-11", category: "vacation" });
    expect(buildMyWeekState(db, me.id, "2026-11-10", "2026-11-09", 0, 0).e.title).toBe("Отпуск");
    expect(buildMyWeekState(db, me.id, "2026-11-10", "2026-11-09", 2, 0).e.title).toBe("Отпуск");
    expect(buildMyWeekState(db, me.id, "2026-11-10", "2026-11-09", 3, 0)).toMatchObject({ n: 0, e: { title: "Нет записей", time: "", hint: "На этот день смен нет" } });
  });
  it("не теряет вторую запись и ограничивает номер страницы после удаления", () => {
    const { db, me } = fixture();
    createShift(db, { employeeId: me.id, date: "2026-11-10", category: "shift", title: "Вечер", start: "12:00", end: "21:00" });
    createShift(db, { employeeId: me.id, date: "2026-11-10", category: "duty", title: "Дежурство", start: "07:00", end: "09:00" });
    expect(buildMyWeekState(db, me.id, "2026-11-10", "2026-11-09", 1, 0)).toMatchObject({ n: 2, p: 0, e: { title: "Дежурство" } });
    expect(buildMyWeekState(db, me.id, "2026-11-10", "2026-11-09", 1, 99)).toMatchObject({ n: 2, p: 1, e: { title: "Вечер" } });
  });
  it("статус больничного учитывает уже одобренную часть продления", () => {
    const { db, me } = fixture();
    const sick = createShift(db, { employeeId: me.id, date: "2026-11-09", endDate: "2026-11-13", category: "sick_leave" });
    markApprovalRequested(db, sick.id, new Date(), { date: "2026-11-09", endDate: "2026-11-10" });
    expect(buildMyWeekState(db, me.id, "2026-11-10", "2026-11-09", 1, 0).e.hint).not.toContain("Ждёт");
    expect(buildMyWeekState(db, me.id, "2026-11-10", "2026-11-09", 2, 0).e.hint).toContain("Ждёт ОК");
  });
  it("переносит границу года и получает цвета пресета из общего справочника", () => {
    const { db, me } = fixture();
    createShift(db, { employeeId: me.id, date: "2027-01-01", category: "shift", templateId: 1, start: "07:00", end: "16:00" });
    const state = buildMyWeekState(db, me.id, "2026-12-31", "2026-12-28", 4, 0);
    expect(state.c[4]).toEqual(["#FEFF01", "У"]);
    expect(state.e.title).toBe("Утро");
  });
  it("длинный и опасный текст остаётся текстом и умещается в 1024 байта", () => {
    const { db, me } = fixture();
    createShift(db, { employeeId: me.id, date: "2026-11-10", category: "shift", title: '<img src=x onerror="bad()">' + '😀\\"Смена'.repeat(500), location: '"\\\nМесто😀'.repeat(500) });
    const state = buildMyWeekState(db, me.id, "2026-11-10", "2026-11-09", 1, 0);
    const serialized = serializeMyWeekState(state);
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(1024);
    expect(state.e.title).toContain("…");
    expect(state.e.hint).toContain("Полностью");
    expect(JSON.parse(serialized).e.title).not.toContain("�");
  });
});
