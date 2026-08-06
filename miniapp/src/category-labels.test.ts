import { describe, expect, it } from "vitest";
import { categoryLabel as sharedLabel } from "@planer/shared";
import { categoryLabel } from "./categories";

/**
 * Подписи категорий лежат в двух копиях сразу: в `./categories` и в
 * `@planer/shared`. Это не про независимость от shared — мини-апп импортирует
 * его в рантайме в доброй половине своих экранов и утилит, а подпись каждой
 * записи и вовсе берёт из shared, через `toEntryView`. Копии просто не
 * объединены, а расходиться им нельзя: сервер берёт слова из shared для письма
 * об изменении графика, а человек, открыв мини-апп, должен увидеть в клетке
 * ровно то, что ему написали в чат.
 *
 * Этот тест и есть сторож их согласия. Объединять таблицы или нет — отдельное
 * решение, которое пока не принято.
 */
const ALL = [
  "shift",
  "vacation",
  "sick_leave",
  "duty",
  "offsite",
  "business_trip",
  "weekend_work",
] as const;

describe("подписи категорий", () => {
  it("совпадают с shared", () => {
    for (const category of ALL) {
      expect(categoryLabel(category), category).toBe(sharedLabel(category));
    }
  });
});
