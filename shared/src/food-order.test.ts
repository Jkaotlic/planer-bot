import { describe, it, expect } from "vitest";
import { placeInputSchema } from "./food-order";

describe("placeInputSchema", () => {
  it("принимает место с меню и обрезает пробелы", () => {
    const parsed = placeInputSchema.parse({ name: "  Шаурмечная ", menu: [{ name: " Шаурма ", price: 350 }] });
    expect(parsed).toEqual({ name: "Шаурмечная", menu: [{ name: "Шаурма", price: 350 }] });
  });

  it("место без меню допустимо — меню по желанию", () => {
    expect(placeInputSchema.safeParse({ name: "Додо", menu: [] }).success).toBe(true);
  });

  it("отвергает нулевую, дробную и огромную цену, пустое имя и 31 блюдо", () => {
    for (const price of [0, 12.5, 100_001]) {
      expect(placeInputSchema.safeParse({ name: "X", menu: [{ name: "Y", price }] }).success).toBe(false);
    }
    expect(placeInputSchema.safeParse({ name: " ", menu: [] }).success).toBe(false);
    const menu = Array.from({ length: 31 }, (_, i) => ({ name: `Блюдо ${i}`, price: 100 }));
    expect(placeInputSchema.safeParse({ name: "X", menu }).success).toBe(false);
  });

  it("два блюда с одним именем — ошибка: кнопки в чате были бы неразличимы", () => {
    const result = placeInputSchema.safeParse({ name: "X", menu: [{ name: "Шаурма", price: 300 }, { name: "шаурма", price: 350 }] });
    expect(result.success).toBe(false);
  });

  // Повторный id в одном присланном меню — не то же самое, что «блюдо из
  // другого места» (это ловит сервис): здесь тело запроса само внутренне
  // противоречиво, и сервис не должен гадать, какая из двух строк — правда.
  it("два блюда с одним id в одном меню — ошибка", () => {
    const result = placeInputSchema.safeParse({
      name: "X",
      menu: [{ id: 1, name: "Шаурма", price: 300 }, { id: 1, name: "Лаваш", price: 200 }],
    });
    expect(result.success).toBe(false);
  });
});
