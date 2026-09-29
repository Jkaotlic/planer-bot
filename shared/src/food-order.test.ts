import { describe, it, expect } from "vitest";
import {
  debtOf, debtors, dishSummary, itemLines, orderInviteText, orderItemInputSchema, orderTotal, organizerSummaryText, payRequestText,
  placeInputSchema,
} from "./food-order";

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

const items = [
  { employeeId: 1, name: "Шаурма", price: 350, qty: 1 },
  { employeeId: 2, name: "Шаурма", price: 350, qty: 2 },
  { employeeId: 2, name: "Чай", price: 50, qty: 1 },
  { employeeId: 3, name: "Лаваш", price: 200, qty: 1 },
];

describe("деньги заказа", () => {
  it("долг человека — сумма его позиций с количеством", () => {
    expect(debtOf(items, 2)).toBe(750);
    expect(debtOf(items, 9)).toBe(0);
    expect(orderTotal(items)).toBe(1300);
  });

  it("должники — все, кроме запускающего, в порядке первого заказа", () => {
    expect(debtors(items, 1)).toEqual([{ employeeId: 2, amount: 750 }, { employeeId: 3, amount: 200 }]);
  });

  it("сводка по блюдам складывает одинаковые, разная цена — разные строки", () => {
    const withPromo = [...items, { employeeId: 3, name: "Шаурма", price: 300, qty: 1 }];
    expect(dishSummary(withPromo)).toEqual([
      { name: "Лаваш", price: 200, qty: 1 },
      { name: "Чай", price: 50, qty: 1 },
      { name: "Шаурма", price: 300, qty: 1 },
      { name: "Шаурма", price: 350, qty: 3 },
    ]);
  });
});

describe("тексты заказа", () => {
  it("приглашение: кто, откуда, до скольки, куда сдавать и мой заказ", () => {
    const text = orderInviteText({
      creatorName: "Аня", placeName: "Шаурмечная", note: "Без лука", payHint: "Перевод по номеру",
      closes: "до 12:30", myItems: [{ name: "Шаурма", price: 350, qty: 2 }], declined: false,
    });
    expect(text).toContain("🍱 Аня собирает заказ: Шаурмечная");
    expect(text).toContain("Приём до 12:30");
    expect(text).toContain("Без лука");
    expect(text).toContain("Куда сдавать: Перевод по номеру");
    expect(text).toContain("Твой заказ:\nШаурма ×2 — 700 ₽\nИтого: 700 ₽");
  });

  it("отказавшийся видит «Ты не заказываешь»", () => {
    expect(orderInviteText({ creatorName: "Аня", placeName: null, note: null, payHint: null, closes: null, myItems: [], declined: true }))
      .toContain("Ты не заказываешь");
  });

  it("сводка запускающему: по блюдам, по людям, итог", () => {
    const names = new Map([[1, "Аня"], [2, "Игорь"], [3, "Марк"]]);
    const text = organizerSummaryText({ placeName: "Шаурмечная", items, names });
    expect(text).toContain("Шаурма ×3 — 1 050 ₽");
    expect(text).toContain("Игорь — 750 ₽");
    expect(text).toContain("Итого: 1 300 ₽");
  });

  it("просьба сдать деньги говорит сколько и кому", () => {
    expect(payRequestText({ creatorName: "Аня", placeName: "Шаурмечная", amount: 750, payHint: "Наличкой мне" }))
      .toBe("💸 Заказ из «Шаурмечная» закрыт. Сдай 750 ₽ — Аня.\nКуда: Наличкой мне");
  });

  it("строки позиций", () => {
    expect(itemLines([{ name: "Чай", price: 50, qty: 1 }])).toEqual(["Чай — 50 ₽"]);
  });
});

describe("orderItemInputSchema", () => {
  it("блюдо из меню или своё; количество по умолчанию 1 и не больше 20", () => {
    expect(orderItemInputSchema.parse({ menuItemId: 3 })).toEqual({ menuItemId: 3, qty: 1 });
    expect(orderItemInputSchema.parse({ name: " Шаурма ", price: 350 })).toEqual({ name: "Шаурма", price: 350, qty: 1 });
    expect(orderItemInputSchema.safeParse({ menuItemId: 3, qty: 21 }).success).toBe(false);
    expect(orderItemInputSchema.safeParse({ name: "X" }).success).toBe(false);
  });

  it("смешанная форма и нулевое количество — отказ", () => {
    expect(orderItemInputSchema.safeParse({ menuItemId: 3, name: "X", price: 1 }).success).toBe(false);
    expect(orderItemInputSchema.safeParse({ menuItemId: 3, qty: 0 }).success).toBe(false);
  });
});
