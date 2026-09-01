import { describe, expect, it } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createChecklistItem, activeChecklistItems } from "./checklist";
import { listActiveTemplates } from "./templates";
import {
  checklistIdsByTemplate,
  createChecklist,
  deleteChecklist,
  getChecklist,
  listChecklists,
  setChecklistTemplates,
  templateIdsOf,
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
    setChecklistTemplates(db, list.id, [first!.id, second!.id]);

    expect(templateIdsOf(db, list.id)).toEqual([first!.id, second!.id]);
  });

  /**
   * Регресс на прод-случай 2026-09-01: админ назначил новому списку тот же вид
   * смены, и старый молча лишился рассылки. Назначение говорит только про свой
   * список и ни у кого ничего не отнимает.
   */
  it("назначение вида смены второму списку не снимает его с первого", () => {
    const db = makeTestDb();
    const first = createChecklist(db, "Дежурства 47");
    const second = createChecklist(db, "Обход этажа");
    const duty = listActiveTemplates(db)[0]!;
    setChecklistTemplates(db, first.id, [duty.id]);
    setChecklistTemplates(db, second.id, [duty.id]);

    expect(templateIdsOf(db, first.id)).toEqual([duty.id]);
    expect(templateIdsOf(db, second.id)).toEqual([duty.id]);
    // Порядок — по id списка: дежурный должен получать сообщения в одном и том
    // же порядке изо дня в день, а не в том, в каком админ кликал кнопки.
    expect(checklistIdsByTemplate(db).get(duty.id)).toEqual([first.id, second.id]);
  });

  // Второй тап по той же кнопке не должен заводить вторую строку и слать
  // дежурному один и тот же список дважды.
  it("повторное назначение того же вида идемпотентно", () => {
    const db = makeTestDb();
    const list = createChecklist(db, "Обход");
    const duty = listActiveTemplates(db)[0]!;
    setChecklistTemplates(db, list.id, [duty.id]);
    setChecklistTemplates(db, list.id, [duty.id, duty.id]);
    expect(templateIdsOf(db, list.id)).toEqual([duty.id]);
  });

  // Удаление не должно оставлять вид смены со ссылкой в пустоту: он бы требовал
  // чек-лист, которого нет, и бот молчал бы, не сказав почему.
  it("удаление снимает привязку у видов смен, не трогая чужие", () => {
    const db = makeTestDb();
    const doomed = createChecklist(db, "Обход");
    const kept = createChecklist(db, "Дежурства 47");
    const template = listActiveTemplates(db)[0]!;
    setChecklistTemplates(db, doomed.id, [template.id]);
    setChecklistTemplates(db, kept.id, [template.id]);

    deleteChecklist(db, doomed.id);
    expect(listChecklists(db).map((l) => l.id)).toEqual([kept.id]);
    expect(checklistIdsByTemplate(db).get(template.id)).toEqual([kept.id]);
  });
});
