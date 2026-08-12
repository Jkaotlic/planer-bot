import { describe, expect, it } from "vitest";
import { categoryLabel as sharedLabel, entryCategorySchema } from "@planer/shared";
import { categoryLabel } from "./categories";

/**
 * Зеркало сторожа из мини-аппа. Подписи категорий лежат в трёх копиях сразу —
 * `@planer/shared`, `miniapp/src/categories.tsx` и эта, — и расходиться им
 * нельзя: сервер берёт слова из shared для письма об изменении графика, а
 * админ, открыв консоль, должен увидеть в клетке ровно то, что человеку
 * написали в чат.
 *
 * Копия в мини-аппе была прикрыта тестом с самого начала, эта — нет.
 * Обнаружилось при переименовании «Выездного мероприятия» в «Мероприятие»:
 * shared и мини-апп поменялись бы принудительно, а консоль тихо осталась бы со
 * старым словом.
 *
 * Категории перебираются из схемы, а не из списка, набранного руками: такой
 * список разъехался бы с реальностью ровно так же, как таблицы, которые он
 * стережёт.
 */
describe("подписи категорий в консоли", () => {
  it("совпадают с shared", () => {
    for (const category of entryCategorySchema.options) {
      expect(categoryLabel(category), category).toBe(sharedLabel(category));
    }
  });
});
