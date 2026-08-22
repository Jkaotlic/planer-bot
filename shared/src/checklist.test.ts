import { describe, expect, it } from "vitest";
import { checklistProgress, checklistText, checklistsDueToday, isChecklistComplete } from "./checklist";

const item = (id: number, title: string) => ({ id, title });

describe("checklistsDueToday", () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    date: "2026-08-24", employeeId: 3, endDate: null, templateId: 5, ...over,
  });
  // Пресет 5 («с 07:00») ведёт на чек-лист 1, пресет 6 («с 08:00») — на 2.
  const byTemplate = new Map([[5, 1], [6, 2]]);

  it("отдаёт чек-лист того вида смены, что стоит сегодня", () => {
    expect(checklistsDueToday([entry()], byTemplate, "2026-08-24", 3)).toEqual([1]);
  });

  /** Ровно то, ради чего правка: у «с семи» и «с восьми» проверки разные. */
  it("у разных видов смен — разные чек-листы", () => {
    expect(checklistsDueToday([entry({ templateId: 6 })], byTemplate, "2026-08-24", 3)).toEqual([2]);
  });

  it("две записи разных видов в один день приносят оба списка, по порядку", () => {
    const day = [entry({ templateId: 6 }), entry({ templateId: 5 })];
    expect(checklistsDueToday(day, byTemplate, "2026-08-24", 3)).toEqual([2, 1]);
  });

  // Один и тот же чек-лист у двух записей — один список, а не два: человек не
  // проходит одни и те же пункты дважды.
  it("один и тот же чек-лист не двоится", () => {
    const day = [entry(), entry({ templateId: 5 })];
    expect(checklistsDueToday(day, byTemplate, "2026-08-24", 3)).toEqual([1]);
  });

  it("вид смены без привязки ничего не приносит", () => {
    expect(checklistsDueToday([entry({ templateId: 2 })], byTemplate, "2026-08-24", 3)).toEqual([]);
  });

  it("не путает дни и людей", () => {
    expect(checklistsDueToday([entry()], byTemplate, "2026-08-25", 3)).toEqual([]);
    expect(checklistsDueToday([entry()], byTemplate, "2026-08-24", 9)).toEqual([]);
  });

  // Запись без пресета взяться может: смену ставят и «своим временем».
  // Привязка живёт на пресете, и без него взять её неоткуда.
  it("запись без пресета чек-листа не приносит", () => {
    expect(checklistsDueToday([entry({ templateId: null })], byTemplate, "2026-08-24", 3)).toEqual([]);
  });

  it("многодневная запись накрывает каждый свой день", () => {
    const span = [entry({ date: "2026-08-24", endDate: "2026-08-26" })];
    expect(checklistsDueToday(span, byTemplate, "2026-08-25", 3)).toEqual([1]);
    expect(checklistsDueToday(span, byTemplate, "2026-08-27", 3)).toEqual([]);
  });
});

describe("checklistProgress", () => {
  const items = [item(1, "Свет"), item(2, "Окна"), item(3, "Двери")];

  it("считает отмеченные из всех", () => {
    expect(checklistProgress(items, [2])).toEqual({ done: 1, total: 3 });
  });

  // Отметка по пункту, который потом убрали, в счёт не идёт: иначе «3 из 2»
  // читается как ошибка системы, а не как история.
  it("отметку по погашенному пункту не считает", () => {
    expect(checklistProgress(items, [2, 99])).toEqual({ done: 1, total: 3 });
  });

  it("пустой список — ноль из нуля, и он не пройден", () => {
    expect(checklistProgress([], [])).toEqual({ done: 0, total: 0 });
    expect(isChecklistComplete([], [])).toBe(false);
  });

  it("пройден, когда отмечены все", () => {
    expect(isChecklistComplete(items, [1, 2, 3])).toBe(true);
    expect(isChecklistComplete(items, [1, 2])).toBe(false);
  });
});

describe("checklistText", () => {
  it("перечисляет пункты, а не пересказывает их числом", () => {
    const text = checklistText([item(1, "Свет"), item(2, "Окна")], [1]);
    expect(text).toContain("Свет");
    expect(text).toContain("Окна");
    // Отмеченное видно отмеченным — человек мог начать в мини-аппе и открыть чат.
    expect(text).toContain("✅");
    expect(text).toContain("◻️");
  });

  it("говорит, сколько уже сделано", () => {
    expect(checklistText([item(1, "Свет"), item(2, "Окна")], [1])).toContain("1 из 2");
  });
});
