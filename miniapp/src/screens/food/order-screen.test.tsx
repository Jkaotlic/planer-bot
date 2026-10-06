// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { FOOD_QTY_MAX, formatMoney } from "@planer/shared";
import { apiClient, type OrderView } from "../../api/client";
import { OrderScreen } from "./OrderScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = null; host = null; vi.restoreAllMocks(); });
async function settle(times = 10) { for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); }
function byText(el: HTMLElement, text: string) {
  return [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
}
function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function mountScreen(orderId: number) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(OrderScreen, { orderId, onBack: vi.fn() }))); });
  await settle();
  return host;
}

const BASE: OrderView = {
  id: 7, creatorId: 1, creatorName: "Аня", placeId: 3, placeName: "Шаурмечная",
  menu: [{ id: 11, name: "Шаурма", price: 350 }, { id: 12, name: "Чай", price: 50 }],
  note: null, payHint: "Наличкой мне", closesAt: "2026-09-29T12:30", closes: "до 12:30",
  open: true, closed: false, cancelled: false, isCreator: false, canManage: false,
  myItems: [], myTotal: 0, declined: false, recipientCount: 3, respondedCount: 1,
  dishes: [], total: 0, people: null,
  payment: { myPaid: false, paidCount: 0, total: 0, rows: null },
};

describe("OrderScreen — участник", () => {
  it("тап по блюду меню вызывает addOrderItem с его id", async () => {
    vi.spyOn(apiClient, "getOrder").mockResolvedValue(BASE);
    const add = vi.spyOn(apiClient, "addOrderItem").mockResolvedValue({ ...BASE, myItems: [{ id: 1, name: "Шаурма", price: 350, qty: 1 }], myTotal: 350 });
    const el = await mountScreen(7);
    await act(async () => byText(el, `Шаурма · ${formatMoney(350)}`).click());
    await settle();
    expect(add).toHaveBeenCalledWith(7, { menuItemId: 11 });
    expect(el.textContent).toContain(`Итого: ${formatMoney(350)}`);
  });

  it("своё блюдо: имя и цена уходят числом", async () => {
    vi.spyOn(apiClient, "getOrder").mockResolvedValue(BASE);
    const add = vi.spyOn(apiClient, "addOrderItem").mockResolvedValue(BASE);
    const el = await mountScreen(7);
    await act(async () => type(el.querySelector<HTMLInputElement>("input[name=custom-name]")!, "Суп дня"));
    await act(async () => type(el.querySelector<HTMLInputElement>("input[name=custom-price]")!, "280"));
    await act(async () => byText(el, "Добавить").click());
    await settle();
    expect(add).toHaveBeenCalledWith(7, { name: "Суп дня", price: 280 });
  });

  it("закрытый заказ не даёт добавлять и показывает, сколько сдать", async () => {
    vi.spyOn(apiClient, "getOrder").mockResolvedValue({ ...BASE, open: false, closed: true, menu: [], myItems: [{ id: 1, name: "Шаурма", price: 350, qty: 1 }], myTotal: 350 });
    const el = await mountScreen(7);
    expect(el.textContent).toContain(`Сдать: ${formatMoney(350)} — Аня`);
    expect(el.querySelector("input[name=custom-name]")).toBeNull();
  });

  it("«+» гаснет на потолке количества (FOOD_QTY_MAX), «−» — на единице", async () => {
    vi.spyOn(apiClient, "getOrder").mockResolvedValue({ ...BASE, myItems: [{ id: 1, name: "Шаурма", price: 350, qty: FOOD_QTY_MAX }, { id: 2, name: "Чай", price: 50, qty: 1 }], myTotal: 350 * FOOD_QTY_MAX + 50 });
    const el = await mountScreen(7);
    const plus = [...el.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "+") as HTMLButtonElement[];
    const minus = [...el.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "−") as HTMLButtonElement[];
    expect(plus.map((b) => b.disabled)).toEqual([true, false]);
    expect(minus.map((b) => b.disabled)).toEqual([false, true]);
  });

  it("участник не видит список «кто сколько»", async () => {
    vi.spyOn(apiClient, "getOrder").mockResolvedValue(BASE);
    const el = await mountScreen(7);
    expect(el.textContent).not.toContain("Кто сколько");
  });
});

describe("OrderScreen — запускающий", () => {
  it("видит «кто сколько», сводку и кнопку закрытия", async () => {
    vi.spyOn(apiClient, "getOrder").mockResolvedValue({
      ...BASE, isCreator: true, canManage: true, total: 350,
      dishes: [{ name: "Шаурма", price: 350, qty: 1 }],
      people: [{ employeeId: 2, displayName: "Игорь", amount: 350, declined: false }, { employeeId: 3, displayName: "Марк", amount: 0, declined: true }],
    });
    const el = await mountScreen(7);
    expect(el.textContent).toContain("Кто сколько");
    expect(el.textContent).toContain(`Игорь — ${formatMoney(350)}`);
    expect(el.textContent).toContain("Марк — не будет");
    expect(byText(el, "Закрыть приём")).toBeTruthy();
  });
});

describe("OrderScreen — деньги", () => {
  it("участник после закрытия жмёт «Я сдал»", async () => {
    vi.spyOn(apiClient, "getOrder").mockResolvedValue({ ...BASE, open: false, closed: true, menu: [], myItems: [{ id: 1, name: "Шаурма", price: 350, qty: 1 }], myTotal: 350, payment: { myPaid: false, paidCount: 0, total: 1, rows: null } });
    const paid = vi.spyOn(apiClient, "setOrderPaid").mockResolvedValue({ ...BASE, open: false, closed: true, payment: { myPaid: true, paidCount: 1, total: 1, rows: null } });
    const el = await mountScreen(7);
    await act(async () => byText(el, "💸 Я сдал").click());
    await settle();
    expect(paid).toHaveBeenCalledWith(7, true);
  });

  // Раньше кнопка «Ты отметился ✓» снимала отметку одним тапом — палец,
  // промахнувшийся по экрану, молча стирал «сдал». Теперь галочка — просто
  // текст, а снять можно только через подтверждение.
  it("«✓ Ты отметился» — текст, тап по нему ничего не делает; «Снять отметку» — через подтверждение", async () => {
    const PAID: OrderView = { ...BASE, open: false, closed: true, menu: [], myItems: [{ id: 1, name: "Шаурма", price: 350, qty: 1 }], myTotal: 350, payment: { myPaid: true, paidCount: 1, total: 1, rows: null } };
    vi.spyOn(apiClient, "getOrder").mockResolvedValue(PAID);
    const paid = vi.spyOn(apiClient, "setOrderPaid").mockResolvedValue({ ...PAID, payment: { myPaid: false, paidCount: 0, total: 1, rows: null } });
    const el = await mountScreen(7);
    const mark = [...el.querySelectorAll<HTMLElement>("*")].find((n) => n.children.length === 0 && n.textContent?.trim() === "✓ Ты отметился");
    expect(mark).toBeTruthy();
    expect(mark!.closest("button")).toBeNull();
    await act(async () => mark!.click());
    await settle();
    expect(paid).not.toHaveBeenCalled();
    await act(async () => byText(el, "Снять отметку").click());
    expect(el.textContent).toContain("Снять отметку о сдаче?");
    expect(paid).not.toHaveBeenCalled();
    await act(async () => byText(el, "Снять").click());
    await settle();
    expect(paid).toHaveBeenCalledWith(7, false);
    expect(byText(el, "💸 Я сдал")).toBeTruthy();
  });

  it("запускающий отмечает наличку за Игоря", async () => {
    vi.spyOn(apiClient, "getOrder").mockResolvedValue({
      ...BASE, open: false, closed: true, isCreator: true, canManage: true, people: [],
      payment: { myPaid: false, paidCount: 0, total: 1, rows: [{ employeeId: 2, displayName: "Игорь", paid: false, markedByAdmin: false, amount: 350 }] },
    });
    const mark = vi.spyOn(apiClient, "setOrderPaymentFor").mockResolvedValue(BASE);
    const el = await mountScreen(7);
    expect(el.textContent).toContain("Кто сдал · 0 из 1");
    await act(async () => el.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
    expect(mark).toHaveBeenCalledWith(7, 2, true);
  });

  // Решение раунда правок: должников нет (`total: 0`) — карточка «Кто сдал»
  // не показывается вовсе, даже если `rows` почему-то не null.
  it("должников нет — карточка «Кто сдал» не показывается", async () => {
    vi.spyOn(apiClient, "getOrder").mockResolvedValue({
      ...BASE, open: false, closed: true, isCreator: true, canManage: true, people: [],
      payment: { myPaid: false, paidCount: 0, total: 0, rows: [] },
    });
    const el = await mountScreen(7);
    expect(el.textContent).not.toContain("Кто сдал");
  });

  it("«Напомнить не сдавшим» показывает «Напомнил: D из N. Не дошло: …»", async () => {
    vi.spyOn(apiClient, "getOrder").mockResolvedValue({
      ...BASE, open: false, closed: true, isCreator: true, canManage: true, people: [],
      payment: { myPaid: false, paidCount: 0, total: 2, rows: [
        { employeeId: 2, displayName: "Игорь", paid: false, markedByAdmin: false, amount: 350 },
        { employeeId: 3, displayName: "Марк", paid: false, markedByAdmin: false, amount: 50 },
      ] },
    });
    const remind = vi.spyOn(apiClient, "remindOrderUnpaid").mockResolvedValue({ delivered: 1, unpaid: 2, unreachable: ["Марк"] });
    const el = await mountScreen(7);
    await act(async () => byText(el, "⏰ Напомнить не сдавшим").click());
    await settle();
    expect(remind).toHaveBeenCalledWith(7);
    expect(el.textContent).toContain("Напомнил: 1 из 2. Не дошло: Марк");
  });

  it("новое действие после дожима убирает старую строку «Напомнил: …»", async () => {
    vi.spyOn(apiClient, "getOrder").mockResolvedValue({
      ...BASE, open: false, closed: true, isCreator: true, canManage: true, people: [],
      payment: { myPaid: false, paidCount: 0, total: 1, rows: [{ employeeId: 2, displayName: "Игорь", paid: false, markedByAdmin: false, amount: 350 }] },
    });
    vi.spyOn(apiClient, "remindOrderUnpaid").mockResolvedValue({ delivered: 1, unpaid: 1, unreachable: [] });
    vi.spyOn(apiClient, "setOrderPaymentFor").mockResolvedValue({
      ...BASE, open: false, closed: true, isCreator: true, canManage: true, people: [],
      payment: { myPaid: false, paidCount: 1, total: 1, rows: [{ employeeId: 2, displayName: "Игорь", paid: true, markedByAdmin: true, amount: 350 }] },
    });
    const el = await mountScreen(7);
    await act(async () => byText(el, "⏰ Напомнить не сдавшим").click());
    await settle();
    expect(el.textContent).toContain("Напомнил: 1 из 1");
    await act(async () => el.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
    await settle();
    expect(el.textContent).not.toContain("Напомнил:");
  });
});

// Ревью раунд 1, находка №4: гонка тика и тапа по меню — сервер уже закрыл
// приём между рендером и кликом. Отказ должен быть виден (наверху, а не под
// карточками) И экран должен перечитать заказ, чтобы погашенные кнопки
// пропали сами, а не висели активными до следующего открытия.
describe("OrderScreen — гонка тика и ручного действия", () => {
  it("addOrderItem отказывает «Приём закрыт.» — текст виден, заказ перечитан заново", async () => {
    const getOrder = vi.spyOn(apiClient, "getOrder").mockResolvedValue(BASE);
    vi.spyOn(apiClient, "addOrderItem").mockRejectedValue(new Error("Приём закрыт."));
    const el = await mountScreen(7);
    await act(async () => byText(el, `Шаурма · ${formatMoney(350)}`).click());
    await settle();
    expect(el.textContent).toContain("Приём закрыт.");
    // Один раз на первую загрузку, второй — после провалившегося действия.
    expect(getOrder).toHaveBeenCalledTimes(2);
  });
});

// Ревью раунд 1, находка №6: отказ загрузки — своим текстом сервера, а не
// общей заглушкой, и с «Повторить», как у списка «Заказы и опросы».
describe("OrderScreen — отказ загрузки", () => {
  it("показывает текст сервера и «Повторить» поднимает заказ заново", async () => {
    const getOrder = vi.spyOn(apiClient, "getOrder")
      .mockRejectedValueOnce(new Error("Заказ не найден или недоступен."))
      .mockResolvedValueOnce(BASE);
    const el = await mountScreen(7);
    expect(el.textContent).toContain("Заказ не найден или недоступен.");
    expect(byText(el, "Повторить")).toBeTruthy();
    await act(async () => byText(el, "Повторить").click());
    await settle();
    expect(getOrder).toHaveBeenCalledTimes(2);
    expect(el.textContent).toContain("Твой заказ");
  });
});

describe("OrderScreen — админ у чужого заказа", () => {
  it("вопрос «Закрыть приём» называет того, кто собирает", async () => {
    vi.spyOn(apiClient, "getOrder").mockResolvedValue({ ...BASE, creatorName: "Игорь", isCreator: false, canManage: true });
    const el = await mountScreen(7);
    await act(async () => byText(el, "Закрыть приём").click());
    expect(el.textContent).toContain("Закрыть чужой заказ (собирает Игорь) и разослать «сдай»?");
  });

  it("«Отменить заказ» спрашивает про отмену, а не про закрытие", async () => {
    vi.spyOn(apiClient, "getOrder").mockResolvedValue({ ...BASE, creatorName: "Игорь", isCreator: false, canManage: true });
    const el = await mountScreen(7);
    await act(async () => byText(el, "Отменить заказ").click());
    expect(el.textContent).toContain("Отменить чужой заказ (собирает Игорь)?");
  });
});
