import { describe, expect, it } from "vitest";
import type { OrderView } from "./api/food";
import { formatMoney } from "./collection";
import {
  cancelOrderQuestion,
  cancelPollQuestion,
  closeOrderQuestion,
  closePollQuestion,
  EMPTY_DISH_NAME,
  FOOD_MENU_FULL_HINT,
  menuItemLabel,
  menuPreview,
  myOrderPayment,
  orderInProgress,
  orderPersonLine,
  orderStatusLabel,
  placeMenuFromRows,
  pollStatusLabel,
  priceDigits,
  remindResultText,
  sendReportText,
} from "./food-view";

const payment = (paidCount: number, total: number, myPaid = false): OrderView["payment"] => ({ myPaid, paidCount, total, rows: null });

describe("статус заказа и опроса", () => {
  // `closes` — просто срок строкой: он не гаснет сам, когда заказ закрыт или
  // отменён (ревью мини-аппа, раунд 1, находка №1).
  it("заказ: отменён / срок / «приём идёт» / «приём закрыт»", () => {
    expect(orderStatusLabel({ cancelled: true, open: false, closes: "до 12:30" })).toBe("отменён");
    expect(orderStatusLabel({ cancelled: false, open: true, closes: "до 12:30" })).toBe("до 12:30");
    expect(orderStatusLabel({ cancelled: false, open: true, closes: null })).toBe("приём идёт");
    expect(orderStatusLabel({ cancelled: false, open: false, closes: "до 12:30" })).toBe("приём закрыт");
  });

  it("опрос: отменён / срок / «идёт» / «закрыт»", () => {
    expect(pollStatusLabel({ cancelled: true, open: false, closes: null })).toBe("отменён");
    expect(pollStatusLabel({ cancelled: false, open: true, closes: "до 18:00" })).toBe("до 18:00");
    expect(pollStatusLabel({ cancelled: false, open: true, closes: null })).toBe("идёт");
    expect(pollStatusLabel({ cancelled: false, open: false, closes: "до 18:00" })).toBe("закрыт");
  });
});

describe("orderInProgress — что остаётся в «Идут», а что уезжает в «Прошедшие»", () => {
  it("открытый — идёт; отменённый — нет, даже с долгами", () => {
    expect(orderInProgress({ cancelled: false, open: true, closed: false, payment: payment(0, 0) })).toBe(true);
    expect(orderInProgress({ cancelled: true, open: false, closed: false, payment: payment(0, 3) })).toBe(false);
  });

  it("срок прошёл, но приём не закрыт — ещё идёт: тик не дошёл, сводки ещё не было", () => {
    expect(orderInProgress({ cancelled: false, open: false, closed: false, payment: payment(0, 0) })).toBe(true);
  });

  it("закрыт, деньги собраны не все — идёт; все сдали — прошёл", () => {
    expect(orderInProgress({ cancelled: false, open: false, closed: true, payment: payment(1, 3) })).toBe(true);
    expect(orderInProgress({ cancelled: false, open: false, closed: true, payment: payment(3, 3) })).toBe(false);
    expect(orderInProgress({ cancelled: false, open: false, closed: true, payment: payment(0, 0) })).toBe(false);
  });
});

describe("деньги и меню — одной строкой на обе морды", () => {
  it("кнопка блюда — имя и цена через formatMoney", () => {
    expect(menuItemLabel({ name: "Шаурма", price: 1200 })).toBe(`Шаурма · ${formatMoney(1200)}`);
    expect(menuItemLabel({ name: "Шаурма", price: 1200 })).toBe("Шаурма · 1\u00a0200\u00a0₽");
  });

  it("превью меню — «имя — цена» через «·», пустое — «Меню пусто»", () => {
    expect(menuPreview([{ name: "Пицца", price: 1200 }, { name: "Суп", price: 300 }])).toBe("Пицца — 1\u00a0200\u00a0₽ · Суп — 300\u00a0₽");
    expect(menuPreview([])).toBe("Меню пусто");
  });

  it("цена из поля — только цифры: «1 200», «350\u00a0₽», «12.50» не становятся NaN", () => {
    expect(priceDigits("1 200")).toBe("1200");
    expect(priceDigits("350 ₽")).toBe("350");
    expect(priceDigits("12.50")).toBe("1250");
    expect(priceDigits("")).toBe("");
  });

  it("«кто сколько»: не будет / сумма / не ответил(а)", () => {
    expect(orderPersonLine({ displayName: "Игорь", amount: 0, declined: true })).toBe("Игорь — не будет");
    expect(orderPersonLine({ displayName: "Марк", amount: 1200, declined: false })).toBe("Марк — 1\u00a0200\u00a0₽");
    expect(orderPersonLine({ displayName: "Лена", amount: 0, declined: false })).toBe("Лена — не ответил(а)");
  });
});

describe("отчёты рассылки", () => {
  it("создание: «Отправлено: N. Не дошло: …»", () => {
    expect(sendReportText({ delivered: 2, unreachable: ["Марк", "Дима"] })).toBe("Отправлено: 2. Не дошло: Марк, Дима");
  });

  it("дожим: все сдали / «D из N» / с недошедшими", () => {
    expect(remindResultText({ delivered: 0, unpaid: 0, unreachable: [] })).toBe("Все уже сдали 🎉");
    expect(remindResultText({ delivered: 2, unpaid: 2, unreachable: [] })).toBe("Напомнил: 2 из 2");
    expect(remindResultText({ delivered: 1, unpaid: 2, unreachable: ["Марк"] })).toBe("Напомнил: 1 из 2. Не дошло: Марк");
  });
});

describe("myOrderPayment — своя оплата участника", () => {
  const base = { open: false, closed: true, cancelled: false, isCreator: false, myTotal: 600, creatorName: "Аня", payment: payment(0, 2) };

  it("закрыт, должен, не отметился — строка «Сдать» и кнопка «Я сдал»", () => {
    expect(myOrderPayment(base)).toEqual({ oweLine: "Сдать: 600\u00a0₽ — Аня", mark: "can-mark" });
  });

  it("уже отметился — «marked»", () => {
    expect(myOrderPayment({ ...base, payment: payment(1, 2, true) }).mark).toBe("marked");
  });

  it("срок прошёл, но приём ещё не закрыт — сдавать уже видно сколько, отмечать рано", () => {
    expect(myOrderPayment({ ...base, closed: false })).toEqual({ oweLine: "Сдать: 600\u00a0₽ — Аня", mark: "none" });
  });

  it("запускающий себе не должен; отменённый и пока открытый — ничего", () => {
    expect(myOrderPayment({ ...base, isCreator: true })).toEqual({ oweLine: null, mark: "none" });
    expect(myOrderPayment({ ...base, cancelled: true, closed: false })).toEqual({ oweLine: null, mark: "none" });
    expect(myOrderPayment({ ...base, open: true, closed: false })).toEqual({ oweLine: null, mark: "none" });
    expect(myOrderPayment({ ...base, myTotal: 0 })).toEqual({ oweLine: null, mark: "none" });
  });
});

describe("вопросы подтверждения: чужой заказ и опрос названы чужими (Review Focus №1)", () => {
  it("свой — прежний вопрос мини-аппа", () => {
    expect(closeOrderQuestion({ isCreator: true, creatorName: "Аня" })).toBe("Закрыть приём и разослать «сдай»?");
    expect(cancelOrderQuestion({ isCreator: true, creatorName: "Аня" })).toBe("Отменить заказ?");
    expect(closePollQuestion({ isCreator: true, creatorName: "Аня" })).toBe("Закрыть опрос?");
    expect(cancelPollQuestion({ isCreator: true, creatorName: "Аня" })).toBe("Отменить опрос?");
  });

  it("чужой — с именем того, кто собирает или спрашивает", () => {
    expect(closeOrderQuestion({ isCreator: false, creatorName: "Игорь" })).toBe("Закрыть чужой заказ (собирает Игорь) и разослать «сдай»?");
    expect(cancelOrderQuestion({ isCreator: false, creatorName: "Игорь" })).toBe("Отменить чужой заказ (собирает Игорь)?");
    expect(closePollQuestion({ isCreator: false, creatorName: "Игорь" })).toBe("Закрыть чужой опрос (спрашивает Игорь)?");
    expect(cancelPollQuestion({ isCreator: false, creatorName: "Игорь" })).toBe("Отменить чужой опрос (спрашивает Игорь)?");
  });
});

describe("placeMenuFromRows — меню из строк редактора", () => {
  it("новая пустая строка отбрасывается, id существующих сохраняются, цена — числом", () => {
    expect(
      placeMenuFromRows([
        { id: 9, name: " Пицца ", price: "600" },
        { name: "", price: "" },
        { name: "Суп", price: "1 200" },
      ]),
    ).toEqual({ ok: true, menu: [{ id: 9, name: "Пицца", price: 600 }, { name: "Суп", price: 1200 }] });
  });

  it("существующее блюдо с пустым именем — ошибка, а не тихое удаление из меню", () => {
    expect(placeMenuFromRows([{ id: 9, name: "  ", price: "600" }])).toEqual({ ok: false, error: EMPTY_DISH_NAME });
    expect(EMPTY_DISH_NAME).toBe("У блюда пустое название — впиши или удали строку ✕.");
  });

  it("блюдо без цены — ошибка с его именем, а не ноль на сервер и общий отказ", () => {
    expect(placeMenuFromRows([{ name: "Шаурма", price: "" }])).toEqual({ ok: false, error: "У «Шаурма» не указана цена." });
    expect(placeMenuFromRows([{ name: "Шаурма", price: "0" }])).toEqual({ ok: false, error: "У «Шаурма» не указана цена." });
  });

  it("подсказка полного меню называет потолок", () => {
    expect(FOOD_MENU_FULL_HINT).toBe("В меню уже 30 блюд — больше не поместится в кнопки бота.");
  });
});
