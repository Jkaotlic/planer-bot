import { describe, expect, it } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { createChecklist } from "./checklists";
import {
  activeChecklistItems,
  createChecklistItem,
  deactivateChecklistItem,
  listMarksFor,
  updateChecklistItem,
  reorderChecklistItem,
  setMark,
} from "./checklist";

/** Пункты чек-листа и отметки по ним. Хранилище: миграция приезжает пустой. */
describe("checklist repo", () => {
  /** Пункты всегда принадлежат чек-листу: «просто пункт» ничей и никому не покажется. */
  const listIn = (db: ReturnType<typeof makeTestDb>) => createChecklist(db, "Обход 47-го").id;

  it("новый чек-лист не несёт ни одного пункта — процедуру пишет команда", () => {
    const db = makeTestDb();
    expect(activeChecklistItems(db, listIn(db))).toEqual([]);
  });

  it("добавляет пункты и держит их в заданном порядке", () => {
    const db = makeTestDb();
    const list = listIn(db);
    createChecklistItem(db, list, "Второй");
    createChecklistItem(db, list, "Первый");
    const items = activeChecklistItems(db, list);
    expect(items.map((i) => i.title)).toEqual(["Второй", "Первый"]);

    reorderChecklistItem(db, list, items[1]!.id, 0);
    expect(activeChecklistItems(db, list).map((i) => i.title)).toEqual(["Первый", "Второй"]);
  });

  it("переименование не заводит второй пункт", () => {
    const db = makeTestDb();
    const list = listIn(db);
    const item = createChecklistItem(db, list, "Проверить свет");
    updateChecklistItem(db, item.id, { title: "Проверить освещение" });
    expect(activeChecklistItems(db, list).map((i) => i.title)).toEqual(["Проверить освещение"]);
  });

  it("пояснение правится отдельно от подписи и стирается пустым", () => {
    const db = makeTestDb();
    const list = listIn(db);
    const item = createChecklistItem(db, list, "Обойти этаж");
    updateChecklistItem(db, item.id, { note: "  По часовой, начиная от лифтов  " });
    expect(activeChecklistItems(db, list)[0]).toMatchObject({ title: "Обойти этаж", note: "По часовой, начиная от лифтов" });

    updateChecklistItem(db, item.id, { title: "Обойти 47-й" });
    expect(activeChecklistItems(db, list)[0]!.note).toBe("По часовой, начиная от лифтов");

    updateChecklistItem(db, item.id, { note: "   " });
    expect(activeChecklistItems(db, list)[0]!.note).toBeNull();
  });

  /**
   * Убранный пункт гасится, а не удаляется: на него ссылаются вчерашние отметки,
   * и «что проверяли в августе» — ровно то, ради чего чек-лист заводят.
   */
  it("убранный пункт исчезает из списка, но не из истории", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const list = listIn(db);
    const item = createChecklistItem(db, list, "Старый пункт");
    setMark(db, { date: "2026-08-20", employeeId: anya.id, itemId: item.id, done: true });

    deactivateChecklistItem(db, item.id);
    expect(activeChecklistItems(db, list)).toEqual([]);
    expect(listMarksFor(db, "2026-08-20", anya.id).map((m) => m.itemId)).toEqual([item.id]);
  });

  it("отметка идемпотентна — двойной тап не оставляет две записи", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const item = createChecklistItem(db, listIn(db), "Пункт");
    setMark(db, { date: "2026-08-21", employeeId: anya.id, itemId: item.id, done: true });
    setMark(db, { date: "2026-08-21", employeeId: anya.id, itemId: item.id, done: true });
    expect(listMarksFor(db, "2026-08-21", anya.id)).toHaveLength(1);
  });

  it("отметку можно снять", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const item = createChecklistItem(db, listIn(db), "Пункт");
    setMark(db, { date: "2026-08-21", employeeId: anya.id, itemId: item.id, done: true });
    setMark(db, { date: "2026-08-21", employeeId: anya.id, itemId: item.id, done: false });
    expect(listMarksFor(db, "2026-08-21", anya.id)).toEqual([]);
  });

  it("отметки разных дней и разных людей не путаются", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });
    const item = createChecklistItem(db, listIn(db), "Пункт");
    setMark(db, { date: "2026-08-21", employeeId: anya.id, itemId: item.id, done: true });
    expect(listMarksFor(db, "2026-08-21", igor.id)).toEqual([]);
    expect(listMarksFor(db, "2026-08-22", anya.id)).toEqual([]);
  });
});
