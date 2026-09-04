import { describe, it, expect } from "vitest";
import { createEntrySchema, entryDateError, updateEntrySchema } from "./entry-schema";
import { EMPTY_CALENDAR, calendarFrom } from "@planer/shared";

describe("entry input schema", () => {
  it("parses a regular shift with a template", () => {
    const r = createEntrySchema.parse({ date: "2026-07-10", start: "08:00", end: "17:00", employeeId: 5, templateId: 1 });
    expect(r.category).toBe("shift"); // default
    expect(r.employeeId).toBe(5);
  });

  it("parses an all-day vacation with a range and no times", () => {
    const r = createEntrySchema.parse({ date: "2026-07-10", endDate: "2026-07-20", category: "vacation" });
    expect(r.category).toBe("vacation");
    expect(r.endDate).toBe("2026-07-20");
  });

  it("rejects a bad category, date, or time", () => {
    expect(createEntrySchema.safeParse({ date: "2026-07-10", category: "bogus" }).success).toBe(false);
    expect(createEntrySchema.safeParse({ date: "10-07-2026" }).success).toBe(false);
    expect(createEntrySchema.safeParse({ date: "2026-07-10", start: "8am" }).success).toBe(false);
  });

  it("update schema makes everything optional", () => {
    expect(updateEntrySchema.parse({ note: "заметка" })).toEqual({ note: "заметка" });
  });

  it("rejects a shift with no times", () => {
    expect(createEntrySchema.safeParse({ date: "2026-07-10" }).success).toBe(false);
  });

  it("accepts a shift with times", () => {
    expect(createEntrySchema.safeParse({ date: "2026-07-10", start: "08:00", end: "17:00" }).success).toBe(true);
  });

  it("rejects an absence that has times", () => {
    expect(
      createEntrySchema.safeParse({ date: "2026-07-10", category: "vacation", start: "08:00", end: "17:00" }).success,
    ).toBe(false);
  });

  it("accepts a duty with times", () => {
    expect(
      createEntrySchema.safeParse({ date: "2026-07-10", category: "duty", start: "09:00", end: "18:00", location: "Вавилова" })
        .success,
    ).toBe(true);
  });

  /**
   * Отпуск, который кончается раньше, чем начался, — запись-призрак: она лежит в
   * базе, но каждый читатель диапазона спрашивает `date <= d && (endDate ?? date) >= d`
   * и не находит её ни в одном дне. Её не видно ни в сетке, ни в командном
   * расписании, ни в выгрузке ростера; распределение считает такого человека
   * свободным и ставит ему смены посреди «отпуска», который админ завёл.
   */
  it("rejects a range that ends before it starts", () => {
    const backwards = createEntrySchema.safeParse({ date: "2026-07-20", endDate: "2026-07-10", category: "vacation" });
    expect(backwards.success).toBe(false);
    const sameDay = createEntrySchema.safeParse({ date: "2026-07-10", endDate: "2026-07-10", category: "vacation" });
    expect(sameDay.success).toBe(true);
  });

  /**
   * Диапазоном живут только три отсутствия — так говорят обе консоли (`isMultiDay`)
   * и так же считает правка: PATCH сбивает `endDate` в null у всего, что считается
   * работой. Создание — единственный вход, который это пропускал.
   */
  it("refuses a day range on a category that is one day's work", () => {
    const spanning = createEntrySchema.safeParse({
      date: "2026-07-20", endDate: "2026-07-24", category: "shift", start: "09:00", end: "18:00",
    });
    expect(spanning.success).toBe(false);
    const oneDay = createEntrySchema.safeParse({
      date: "2026-07-20", endDate: "2026-07-20", category: "shift", start: "09:00", end: "18:00",
    });
    expect(oneDay.success).toBe(true);
    const vacation = createEntrySchema.safeParse({ date: "2026-07-20", endDate: "2026-07-24", category: "vacation" });
    expect(vacation.success).toBe(true);
  });

  /**
   * «Работа в выходной» = выходной ПО КАЛЕНДАРЮ, и судит об этом маршрут, а не
   * схема: праздники лежат в базе, а схема разбора синхронна и базы не видит.
   * Здесь остаётся то, что схема действительно проверяет, — форма записи.
   * Правило про день проверяется в `entries-holiday.test.ts`.
   */
  it("схема пропускает день, о котором судит календарь", () => {
    // 2026-06-12 — День России, пятница: без календаря это будни, и всё равно
    // отказывать здесь схема не должна — она не знает, праздник ли это.
    const holiday = createEntrySchema.safeParse({ date: "2026-06-12", category: "weekend_work", start: "10:00", end: "18:00" });
    expect(holiday.success).toBe(true);

    expect(entryDateError({ category: "weekend_work", date: "2026-06-12" }, EMPTY_CALENDAR)).toMatch(/выходной или праздник/);
    expect(
      entryDateError({ category: "weekend_work", date: "2026-06-12" }, calendarFrom([{ date: "2026-06-12", kind: "holiday" }])),
    ).toBeNull();
  });
});