import { describe, expect, it } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import {
  activeChecklistItems,
  createChecklistItem,
  deactivateChecklistItem,
  listMarksFor,
  renameChecklistItem,
  reorderChecklistItem,
  setMark,
} from "./checklist";

/** Пункты чек-листа и отметки по ним. Хранилище: миграция приезжает пустой. */
describe("checklist repo", () => {
  it("новая база не несёт ни одного пункта — процедуру пишет команда, а не репозиторий", () => {
    expect(activeChecklistItems(makeTestDb())).toEqual([]);
  });

  it("добавляет пункты и держит их в заданном порядке", () => {
    const db = makeTestDb();
    createChecklistItem(db, "Второй");
    createChecklistItem(db, "Первый");
    const items = activeChecklistItems(db);
    expect(items.map((i) => i.title)).toEqual(["Второй", "Первый"]);

    reorderChecklistItem(db, items[1]!.id, 0);
    expect(activeChecklistItems(db).map((i) => i.title)).toEqual(["Первый", "Второй"]);
  });

  it("переименование не заводит второй пункт", () => {
    const db = makeTestDb();
    const item = createChecklistItem(db, "Проверить свет");
    renameChecklistItem(db, item.id, "Проверить освещение");
    expect(activeChecklistItems(db).map((i) => i.title)).toEqual(["Проверить освещение"]);
  });

  /**
   * Убранный пункт гасится, а не удаляется: на него ссылаются вчерашние отметки,
   * и «что проверяли в августе» — ровно то, ради чего чек-лист заводят.
   */
  it("убранный пункт исчезает из списка, но не из истории", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const item = createChecklistItem(db, "Старый пункт");
    setMark(db, { date: "2026-08-20", employeeId: anya.id, itemId: item.id, done: true });

    deactivateChecklistItem(db, item.id);
    expect(activeChecklistItems(db)).toEqual([]);
    expect(listMarksFor(db, "2026-08-20", anya.id).map((m) => m.itemId)).toEqual([item.id]);
  });

  it("отметка идемпотентна — двойной тап не оставляет две записи", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const item = createChecklistItem(db, "Пункт");
    setMark(db, { date: "2026-08-21", employeeId: anya.id, itemId: item.id, done: true });
    setMark(db, { date: "2026-08-21", employeeId: anya.id, itemId: item.id, done: true });
    expect(listMarksFor(db, "2026-08-21", anya.id)).toHaveLength(1);
  });

  it("отметку можно снять", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const item = createChecklistItem(db, "Пункт");
    setMark(db, { date: "2026-08-21", employeeId: anya.id, itemId: item.id, done: true });
    setMark(db, { date: "2026-08-21", employeeId: anya.id, itemId: item.id, done: false });
    expect(listMarksFor(db, "2026-08-21", anya.id)).toEqual([]);
  });

  it("отметки разных дней и разных людей не путаются", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });
    const item = createChecklistItem(db, "Пункт");
    setMark(db, { date: "2026-08-21", employeeId: anya.id, itemId: item.id, done: true });
    expect(listMarksFor(db, "2026-08-21", igor.id)).toEqual([]);
    expect(listMarksFor(db, "2026-08-22", anya.id)).toEqual([]);
  });
});
