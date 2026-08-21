import { describe, expect, it } from "vitest";
import { checklistProgress, checklistText, isChecklistComplete, needsChecklistToday } from "./checklist";

const item = (id: number, title: string) => ({ id, title });

describe("needsChecklistToday", () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    date: "2026-08-24", employeeId: 3, endDate: null, templateId: 5, ...over,
  });
  // Галочка стоит на пресете 5.
  const requires = new Set([5]);

  it("положен тому, у кого сегодня стоит запись отмеченного вида", () => {
    expect(needsChecklistToday([entry()], requires, "2026-08-24", 3)).toBe(true);
  });

  it("не положен, если вид смены галочки не несёт", () => {
    expect(needsChecklistToday([entry({ templateId: 2 })], requires, "2026-08-24", 3)).toBe(false);
  });

  it("не положен в другой день и другому человеку", () => {
    expect(needsChecklistToday([entry()], requires, "2026-08-25", 3)).toBe(false);
    expect(needsChecklistToday([entry()], requires, "2026-08-24", 9)).toBe(false);
  });

  // Запись без пресета взяться может: смену ставят и «своим временем». Галочка
  // живёт на пресете, и без него сказать «этот вид требует чек-лист» нечем.
  it("запись без пресета чек-листа не требует", () => {
    expect(needsChecklistToday([entry({ templateId: null })], requires, "2026-08-24", 3)).toBe(false);
  });

  it("многодневная запись накрывает каждый свой день", () => {
    const span = [entry({ date: "2026-08-24", endDate: "2026-08-26" })];
    expect(needsChecklistToday(span, requires, "2026-08-25", 3)).toBe(true);
    expect(needsChecklistToday(span, requires, "2026-08-27", 3)).toBe(false);
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
