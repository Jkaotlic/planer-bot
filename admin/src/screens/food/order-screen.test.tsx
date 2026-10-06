// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { FOOD_TEXT_MAX, formatMoney, menuItemLabel } from "@planer/shared";
import { apiClient } from "../../api/client";
import { orderView } from "./food-fixtures";
import { button, click, maybeButton, mount, type, unmount, waitFor } from "./food-test-kit";
import { OrderScreen } from "./OrderScreen";

afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
});

const area = (el: HTMLElement, name: string) => el.querySelector<HTMLElement>(`[data-area="${name}"]`);
const DODO_MENU = [{ id: 11, name: "Пицца", price: 1200 }];

async function open(order = orderView({ menu: DODO_MENU })) {
  vi.spyOn(apiClient, "getOrder").mockResolvedValue(order);
  const el = await mount(OrderScreen, { orderId: 7, onBack: vi.fn(), onAuthRequired: vi.fn() });
  await waitFor(() => expect(el.querySelector("h2")?.textContent).toBe(`🍱 ${order.placeName ?? "Заказ без меню"}`));
  return el;
}

describe("консоль: заказ — своё", () => {
  it("блюдо из меню: кнопка с ценой как в мини-аппе, позиция уходит по id, итог — formatMoney", async () => {
    const add = vi.spyOn(apiClient, "addOrderItem").mockResolvedValue(
      orderView({ menu: DODO_MENU, myItems: [{ id: 5, name: "Пицца", price: 1200, qty: 1 }], myTotal: 1200 }),
    );
    const el = await open();
    await click(button(area(el, "menu")!, menuItemLabel(DODO_MENU[0]!)));
    await waitFor(() => expect(area(el, "mine")!.textContent).toContain(`Итого: ${formatMoney(1200)}`));
    expect(add).toHaveBeenCalledWith(7, { menuItemId: 11 });
  });

  it("своё блюдо: цена — только цифры, уходит числом; поля очищаются", async () => {
    const add = vi.spyOn(apiClient, "addOrderItem").mockResolvedValue(orderView({ menu: DODO_MENU }));
    const el = await open();
    const name = el.querySelector<HTMLInputElement>('input[aria-label="Своё блюдо"]')!;
    const price = el.querySelector<HTMLInputElement>('input[aria-label="Цена, ₽"]')!;
    expect(name.maxLength).toBe(FOOD_TEXT_MAX);
    // Поле консоли — `input[type="text"]`: без `type` оно рисовалось голым браузерным.
    expect(name.getAttribute("type")).toBe("text");
    expect(price.getAttribute("type")).toBe("text");
    expect(price.inputMode).toBe("numeric");
    await type(name, "Суп дня");
    await type(price, "1 200 ₽");
    expect(price.value).toBe("1200");
    await click(button(area(el, "custom")!, "Добавить"));
    await waitFor(() => expect(add).toHaveBeenCalledWith(7, { name: "Суп дня", price: 1200 }));
    await waitFor(() => expect(name.value).toBe(""));
  });

  it("количество: «−» погашен на одной штуке, «+» шлёт qty + 1, «✕» убирает", async () => {
    const mine = orderView({ menu: DODO_MENU, myItems: [{ id: 5, name: "Пицца", price: 1200, qty: 1 }], myTotal: 1200 });
    const qty = vi.spyOn(apiClient, "setOrderItemQty").mockResolvedValue(mine);
    const remove = vi.spyOn(apiClient, "removeOrderItem").mockResolvedValue(orderView({ menu: DODO_MENU }));
    const el = await open(mine);
    expect(button(el, "Меньше: Пицца").disabled).toBe(true);
    await click(button(el, "Больше: Пицца"));
    await waitFor(() => expect(qty).toHaveBeenCalledWith(7, 5, 2));
    await click(button(el, "Убрать: Пицца"));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(7, 5));
  });

  it("закрыт и должен — «Сдать: … — Аня» и «💸 Я сдал»", async () => {
    const owe = orderView({ open: false, closed: true, isCreator: false, canManage: false, myTotal: 600, myItems: [{ id: 5, name: "Суп", price: 600, qty: 1 }], people: null, payment: { myPaid: false, paidCount: 0, total: 2, rows: null } });
    const paid = vi.spyOn(apiClient, "setOrderPaid").mockResolvedValue({ ...owe, payment: { ...owe.payment, myPaid: true } });
    const el = await open(owe);
    expect(area(el, "mine")!.textContent).toContain("Сдать: 600\u00a0₽ — Аня");
    await click(button(el, "💸 Я сдал"));
    await waitFor(() => expect(area(el, "mine")!.textContent).toContain("✓ Ты отметился"));
    expect(paid).toHaveBeenCalledWith(7, true);
  });

  it("длинное меню: 30 блюд по 200 знаков — все 30 кнопок на месте (Review Focus №3)", async () => {
    const menu = Array.from({ length: 30 }, (_, i) => ({ id: 100 + i, name: `${i + 1} ${"щ".repeat(FOOD_TEXT_MAX - 3)}`, price: 100 }));
    const el = await open(orderView({ menu }));
    const buttons = [...area(el, "menu")!.querySelectorAll("button")];
    expect(buttons).toHaveLength(30);
    // Длинное название переносится внутри кнопки только в `.food-buttons .btn` (а оно
    // — внутри карточки, где `overflow-wrap: anywhere`): вне этого контейнера кнопка
    // растянула бы страницу вбок. Правила самих классов держит food-css.test.ts.
    for (const b of buttons) {
      expect(b.closest(".food-buttons")).not.toBeNull();
      expect(b.closest(".food-card")).not.toBeNull();
    }
    expect(buttons[0]!.textContent).toContain("щ".repeat(FOOD_TEXT_MAX - 3));
  });

  it("название блюда в 200 знаков без пробела — внутри карточки, где слово переносится", async () => {
    const long = "щ".repeat(FOOD_TEXT_MAX);
    const el = await open(orderView({
      menu: DODO_MENU, myItems: [{ id: 5, name: long, price: 100, qty: 1 }], myTotal: 100,
      dishes: [{ name: long, price: 100, qty: 1 }], total: 100,
      people: [{ employeeId: 2, displayName: "Игорь", amount: 100, declined: false }],
    }));
    for (const name of ["mine", "people"]) {
      const card = area(el, name)!;
      expect(card.classList.contains("food-card")).toBe(true);
      expect(card.textContent).toContain(long);
    }
  });
});

describe("консоль: заказ — отказы сервера видны рядом с действием (Review Focus №2)", () => {
  it("отказ на блюде меню — в карточке меню, когда она осталась", async () => {
    vi.spyOn(apiClient, "addOrderItem").mockRejectedValue(new Error("Больше 20 позиций — это уже не обед."));
    const el = await open();
    const getOrder = vi.mocked(apiClient.getOrder);
    await click(button(area(el, "menu")!, menuItemLabel(DODO_MENU[0]!)));
    await waitFor(() => expect(area(el, "menu")!.querySelector('[role="alert"]')?.textContent).toBe("Больше 20 позиций — это уже не обед."));
    expect(getOrder).toHaveBeenCalledTimes(2);
  });

  it("гонка с тиком: «Приём закрыт.» — меню погасло, отказ поднят над колонками, а не пропал с ним", async () => {
    vi.spyOn(apiClient, "addOrderItem").mockRejectedValue(new Error("Приём закрыт."));
    const el = await open();
    vi.mocked(apiClient.getOrder).mockResolvedValue(orderView({ menu: [], open: false, closed: true }));
    await click(button(area(el, "menu")!, menuItemLabel(DODO_MENU[0]!)));
    await waitFor(() => expect(area(el, "menu")).toBeNull());
    expect(area(el, "top")?.textContent).toBe("Приём закрыт.");
  });

  it("закрытие без связи — отказ в «Управлении»", async () => {
    vi.spyOn(apiClient, "closeOrder").mockRejectedValue(new Error("Нет связи с сервером — проверь интернет и попробуй ещё раз."));
    const el = await open();
    vi.mocked(apiClient.getOrder).mockRejectedValue(new Error("Нет связи с сервером — проверь интернет и попробуй ещё раз."));
    await click(button(el, "Закрыть приём"));
    await click(button(el, "Закрыть"));
    await waitFor(() => expect(area(el, "manage")!.querySelector('[role="alert"]')?.textContent).toContain("Нет связи с сервером"));
  });

  it("заказ не загрузился — текст и «Повторить», который грузит снова", async () => {
    const getOrder = vi.spyOn(apiClient, "getOrder").mockRejectedValueOnce(new Error("Заказ не найден.")).mockResolvedValueOnce(orderView());
    const el = await mount(OrderScreen, { orderId: 7, onBack: vi.fn(), onAuthRequired: vi.fn() });
    await waitFor(() => expect(el.querySelector('[role="alert"]')?.textContent).toBe("Заказ не найден."));
    await click(button(el, "Повторить"));
    await waitFor(() => expect(el.querySelector("h2")?.textContent).toBe("🍱 Додо"));
    expect(getOrder).toHaveBeenCalledTimes(2);
  });
});

describe("консоль: заказ — собирающему и админу", () => {
  it("чужой заказ: вопрос называет того, кто собирает (Review Focus №1); закрытие — после второго клика", async () => {
    const theirs = orderView({ creatorName: "Игорь", isCreator: false, canManage: true });
    const close = vi.spyOn(apiClient, "closeOrder").mockResolvedValue({ ...theirs, open: false, closed: true });
    const el = await open(theirs);
    await click(button(el, "Закрыть приём"));
    expect(close).not.toHaveBeenCalled();
    expect(area(el, "manage")!.textContent).toContain("Закрыть чужой заказ (собирает Игорь) и разослать «сдай»?");
    await click(button(el, "Закрыть"));
    await waitFor(() => expect(close).toHaveBeenCalledWith(7));
  });

  it("«Что заказать» и «Кто сколько» — строками shared; без права управлять — карточки нет", async () => {
    const el = await open(orderView({
      dishes: [{ name: "Пицца", price: 1200, qty: 2 }], total: 2400,
      people: [
        { employeeId: 2, displayName: "Игорь", amount: 0, declined: true },
        { employeeId: 3, displayName: "Марк", amount: 1200, declined: false },
        { employeeId: 5, displayName: "Лена", amount: 0, declined: false },
      ],
    }));
    const people = area(el, "people")!.textContent!;
    expect(people).toContain("Пицца ×2 — 2\u00a0400\u00a0₽");
    expect(people).toContain("Игорь — не будет");
    expect(people).toContain("Марк — 1\u00a0200\u00a0₽");
    expect(people).toContain("Лена — не ответил(а)");
    expect(people).toContain("Итого: 2\u00a0400\u00a0₽");
    await unmount();
    const el2 = await open(orderView({ people: null, canManage: false, isCreator: false }));
    expect(area(el2, "people")).toBeNull();
    expect(maybeButton(el2, "Закрыть приём")).toBeUndefined();
  });

  it("«Кто сдал»: галочка за человека и дожим с отчётом в той же карточке", async () => {
    const closed = orderView({
      open: false, closed: true,
      payment: { myPaid: false, paidCount: 0, total: 2, rows: [
        { employeeId: 2, displayName: "Игорь", paid: false, markedByAdmin: false, amount: 600 },
        { employeeId: 3, displayName: "Марк", paid: false, markedByAdmin: false, amount: 1200 },
      ] },
    });
    const forPerson = vi.spyOn(apiClient, "setOrderPaymentFor").mockResolvedValue(closed);
    vi.spyOn(apiClient, "remindOrderUnpaid").mockResolvedValue({ delivered: 1, unpaid: 2, unreachable: ["Марк"] });
    const el = await open(closed);
    const payments = area(el, "payments")!;
    expect(payments.textContent).toContain("Кто сдал · 0 из 2");
    const igor = [...payments.querySelectorAll("label")].find((l) => l.textContent?.includes("Игорь"))!.querySelector("input")!;
    await click(igor);
    await waitFor(() => expect(forPerson).toHaveBeenCalledWith(7, 2, true));
    await click(button(payments, "⏰ Напомнить не сдавшим"));
    await waitFor(() => expect(payments.querySelector('[role="status"]')?.textContent).toBe("Напомнил: 1 из 2. Не дошло: Марк"));
  });
});
