import { describe, expect, it } from "vitest";
import { categoryLabel as sharedLabel } from "@planer/shared";
import { categoryLabel } from "./categories";

/**
 * Мини-апп намеренно не зависит от `@planer/shared` в рантайме — его подписи
 * категорий это осознанная копия. Расходиться копии не должны: сервер берёт
 * слова из shared для письма об изменении графика, а человек, открыв мини-апп,
 * должен увидеть в клетке ровно то, что ему написали в чат.
 *
 * Импорт shared здесь и только здесь: это тест, в бандл он не попадает.
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
