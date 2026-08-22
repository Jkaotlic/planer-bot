import { describe, expect, it } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createChecklistItem, activeChecklistItems } from "./checklist";
import { listActiveTemplates } from "./templates";
import {
  createChecklist,
  deleteChecklist,
  getChecklist,
  listChecklists,
  setTemplateChecklist,
  updateChecklist,
} from "./checklists";

describe("checklists", () => {
  it("новая база не несёт ни одного чек-листа", () => {
    expect(listChecklists(makeTestDb())).toEqual([]);
  });

  /**
   * Ровно то, ради чего сущность и заведена: у дежурного с семи и у дежурного с
   * восьми проверки разные, и списки не должны пересекаться.
   */
  it("держит несколько чек-листов, и пункты каждого — свои", () => {
    const db = makeTestDb();
    const early = createChecklist(db, "Дежурство с 07:00");
    const late = createChecklist(db, "Утро с 08:00");
    createChecklistItem(db, early.id, "Открыть 47-й");
    createChecklistItem(db, late.id, "Проверить переговорные");

    expect(activeChecklistItems(db, early.id).map((i) => i.title)).toEqual(["Открыть 47-й"]);
    expect(activeChecklistItems(db, late.id).map((i) => i.title)).toEqual(["Проверить переговорные"]);
  });

  it("правит имя и инструкцию по отдельности и стирает пустым", () => {
    const db = makeTestDb();
    const list = createChecklist(db, "Обход");
    updateChecklist(db, list.id, { note: " По часовой ", docUrl: "https://disk.example/47.pdf" });
    expect(getChecklist(db, list.id)).toMatchObject({ name: "Обход", note: "По часовой", docUrl: "https://disk.example/47.pdf" });

    updateChecklist(db, list.id, { name: "Обход 47-го" });
    expect(getChecklist(db, list.id)).toMatchObject({ name: "Обход 47-го", note: "По часовой" });

    updateChecklist(db, list.id, { note: "  " });
    expect(getChecklist(db, list.id)!.note).toBeNull();
  });

  it("один чек-лист обслуживает несколько видов смен — это и есть «скоп»", () => {
    const db = makeTestDb();
    const list = createChecklist(db, "Обход 47-го");
    const [first, second] = listActiveTemplates(db);
    setTemplateChecklist(db, first!.id, list.id);
    setTemplateChecklist(db, second!.id, list.id);

    const linked = listActiveTemplates(db).filter((t) => t.checklistId === list.id);
    expect(linked.map((t) => t.id)).toEqual([first!.id, second!.id]);
  });

  // Удаление не должно оставлять вид смены со ссылкой в пустоту: он бы требовал
  // чек-лист, которого нет, и бот молчал бы, не сказав почему.
  it("удаление снимает привязку у видов смен", () => {
    const db = makeTestDb();
    const list = createChecklist(db, "Обход");
    const template = listActiveTemplates(db)[0]!;
    setTemplateChecklist(db, template.id, list.id);

    deleteChecklist(db, list.id);
    expect(listChecklists(db)).toEqual([]);
    expect(listActiveTemplates(db).find((t) => t.id === template.id)!.checklistId).toBeNull();
  });
});
