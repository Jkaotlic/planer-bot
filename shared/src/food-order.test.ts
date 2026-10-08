import { describe, it, expect } from "vitest";
import { formatMoney } from "./collection";
import {
  debtOf, debtors, dishSummary, formatKg, itemLines, orderInviteText, orderItemInputSchema, orderTotal, organizerSummaryText, payRequestText,
  placeInputSchema, splitAtLines,
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
      { name: "Лаваш", price: 200, qty: 1, unit: "pcs", stepGrams: null },
      { name: "Чай", price: 50, qty: 1, unit: "pcs", stepGrams: null },
      { name: "Шаурма", price: 300, qty: 1, unit: "pcs", stepGrams: null },
      { name: "Шаурма", price: 350, qty: 3, unit: "pcs", stepGrams: null },
    ]);
  });
});

describe("тексты заказа", () => {
  it("приглашение: кто, откуда, до скольки, куда сдавать и мой заказ", () => {
    const text = orderInviteText({
      creatorName: "Аня", title: null, placeName: "Шаурмечная", note: "Без лука", payHint: "Перевод по номеру",
      closes: "до 12:30", myItems: [{ name: "Шаурма", price: 350, qty: 2 }], declined: false,
    });
    expect(text).toContain("🍱 Аня собирает заказ: Шаурмечная");
    expect(text).toContain("Приём до 12:30");
    expect(text).toContain("Без лука");
    expect(text).toContain("Куда сдавать: Перевод по номеру");
    expect(text).toContain("Твой заказ:\nШаурма ×2 — 700 ₽\nИтого: 700 ₽");
  });

  it("отказавшийся видит «Ты не заказываешь»", () => {
    expect(orderInviteText({ creatorName: "Аня", title: null, placeName: null, note: null, payHint: null, closes: null, myItems: [], declined: true }))
      .toContain("Ты не заказываешь");
  });

  it("сводка запускающему: по блюдам, по людям, итог", () => {
    const names = new Map([[1, "Аня"], [2, "Игорь"], [3, "Марк"]]);
    const text = organizerSummaryText({ title: null, placeName: "Шаурмечная", items, names });
    expect(text).toContain("Шаурма ×3 — 1 050 ₽");
    expect(text).toContain("Игорь — 750 ₽");
    expect(text).toContain("Итого: 1 300 ₽");
  });

  it("просьба сдать деньги говорит сколько и кому", () => {
    expect(payRequestText({ creatorName: "Аня", title: null, placeName: "Шаурмечная", amount: 750, payHint: "Наличкой мне" }))
      .toBe("💸 Заказ из «Шаурмечная» закрыт. Сдай 750 ₽ — Аня.\nКуда: Наличкой мне");
  });

  it("строки позиций", () => {
    expect(itemLines([{ name: "Чай", price: 50, qty: 1 }])).toEqual(["Чай — 50 ₽"]);
  });
});

describe("orderItemInputSchema", () => {
  it("блюдо из меню или своё; у своего количество по умолчанию 1 и не больше 20", () => {
    expect(orderItemInputSchema.parse({ menuItemId: 3 })).toEqual({ menuItemId: 3 });
    expect(orderItemInputSchema.parse({ name: " Шаурма ", price: 350 })).toEqual({ name: "Шаурма", price: 350, qty: 1 });
    expect(orderItemInputSchema.safeParse({ name: "Шаурма", price: 350, qty: 21 }).success).toBe(false);
    expect(orderItemInputSchema.safeParse({ name: "X" }).success).toBe(false);
  });

  // Ручка на блюдо из меню всегда прибавляет одну штуку (как тап в чате) —
  // принятое и молча проигнорированное `qty` обманывало бы вызывающего.
  it("у блюда из меню количества нет — «qty» в теле — отказ", () => {
    expect(orderItemInputSchema.safeParse({ menuItemId: 3, qty: 2 }).success).toBe(false);
  });

  it("смешанная форма и нулевое количество — отказ", () => {
    expect(orderItemInputSchema.safeParse({ menuItemId: 3, name: "X", price: 1 }).success).toBe(false);
    expect(orderItemInputSchema.safeParse({ name: "X", price: 1, qty: 0 }).success).toBe(false);
  });
});

describe("splitAtLines", () => {
  it("короткий текст — одним куском", () => {
    expect(splitAtLines("а\nб", 10)).toEqual(["а\nб"]);
  });

  it("длинный режется по границам строк: каждый кусок не длиннее лимита, склейка даёт исходник", () => {
    const text = Array.from({ length: 50 }, (_, i) => `строка ${i} ${"я".repeat(30)}`).join("\n");
    const parts = splitAtLines(text, 200);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(200);
    expect(parts.join("\n")).toBe(text);
    // Строка не рвётся посередине: каждый кусок начинается с «строка».
    for (const part of parts) expect(part.startsWith("строка")).toBe(true);
  });

  it("перенос строки считается в длину: «aaaaa» + «\\n» + «bbbb» = 10 уже не влезает в 9", () => {
    expect(splitAtLines("aaaaa\nbbbb\nc", 9)).toEqual(["aaaaa", "bbbb\nc"]);
  });

  it("одна строка длиннее лимита режется жёстко — Telegram иначе откажет целиком", () => {
    const parts = splitAtLines("я".repeat(25), 10);
    expect(parts).toEqual(["я".repeat(10), "я".repeat(10), "я".repeat(5)]);
  });
});

describe("вес", () => {
  it("граммы печатаются килограммами с запятой и без хвостовых нулей", () => {
    expect([400, 1200, 250, 3000, 10, 100_000].map(formatKg)).toEqual(["0,4", "1,2", "0,25", "3", "0,01", "100"]);
  });
});

describe("строки позиций с единицей", () => {
  it("штуки — как раньше, и без поля unit тоже", () => {
    expect(itemLines([{ name: "Шаурма", price: 350, qty: 2 }])).toEqual([`Шаурма ×2 — ${formatMoney(700)}`]);
    expect(itemLines([{ name: "Чай", price: 50, qty: 1, unit: "pcs", stepGrams: null }])).toEqual([`Чай — ${formatMoney(50)}`]);
  });
  it("кг: количество шагов, шаг и итоговый вес; один шаг — без множителя", () => {
    expect(itemLines([{ name: "Икра кетовая", price: 2400, qty: 3, unit: "kg", stepGrams: 400 }]))
      .toEqual([`Икра кетовая — 3 × 0,4 кг (1,2 кг) — ${formatMoney(7200)}`]);
    expect(itemLines([{ name: "Икра кетовая", price: 2400, qty: 1, unit: "kg", stepGrams: 400 }]))
      .toEqual([`Икра кетовая — 0,4 кг — ${formatMoney(2400)}`]);
  });
  it("три тапа по 0,1 кг — ровно 0,3 кг, без хвоста плавающей точки", () => {
    expect(itemLines([{ name: "Сыр", price: 100, qty: 3, unit: "kg", stepGrams: 100 }])[0]).toContain("(0,3 кг)");
  });
});

describe("сводка по позициям", () => {
  it("одно имя и цена, но разный шаг — разные строки", () => {
    const rows = dishSummary([
      { employeeId: 1, name: "Икра", price: 2400, qty: 2, unit: "kg", stepGrams: 400 },
      { employeeId: 2, name: "Икра", price: 2400, qty: 1, unit: "kg", stepGrams: 500 },
      { employeeId: 3, name: "Икра", price: 2400, qty: 3, unit: "kg", stepGrams: 400 },
    ]);
    expect(rows.map((r) => [r.qty, r.stepGrams])).toEqual([[5, 400], [1, 500]]);
  });
});

describe("закупка с названием", () => {
  const items = [
    { employeeId: 2, name: "Икра кетовая", price: 2400, qty: 3, unit: "kg" as const, stepGrams: 400 },
    { employeeId: 2, name: "Горбуша", price: 500, qty: 1 },
    { employeeId: 3, name: "Горбуша", price: 500, qty: 2 },
  ];
  const names = new Map([[2, "Игорь"], [3, "Марк"]]);

  it("письмо начинается с названия, если оно есть", () => {
    const text = orderInviteText({ creatorName: "Аня", title: "Икра, доставка 09.10", placeName: "Икра", note: null, payHint: null, closes: null, myItems: [], declined: false });
    expect(text.split("\n")[0]).toBe("🛒 Аня собирает: Икра, доставка 09.10");
  });
  it("без названия — прежний заголовок", () => {
    const text = orderInviteText({ creatorName: "Аня", title: null, placeName: "Шаурмечная", note: null, payHint: null, closes: null, myItems: [], declined: false });
    expect(text.split("\n")[0]).toBe("🍱 Аня собирает заказ: Шаурмечная");
  });
  it("итог: «Кто что» — имя с суммой, под ним его позиции", () => {
    const text = organizerSummaryText({ title: "Икра, доставка 09.10", placeName: "Икра", items, names });
    expect(text).toContain("📋 Сбор «Икра, доставка 09.10» закрыт.");
    expect(text).toContain("Кто что:");
    expect(text).not.toContain("Кто сколько:");
    const lines = text.split("\n");
    const igor = lines.findIndex((l) => l.startsWith("Игорь — "));
    expect(lines[igor + 1]).toBe(`  ${itemLines([items[0]!])[0]}`);
    expect(lines[igor + 2]).toBe(`  ${itemLines([items[1]!])[0]}`);
  });
  it("«Сдай» называет сбор по названию", () => {
    expect(payRequestText({ creatorName: "Аня", title: "Икра, доставка 09.10", placeName: "Икра", amount: 7700, payHint: null }))
      .toContain("Сбор «Икра, доставка 09.10» закрыт.");
  });
});
