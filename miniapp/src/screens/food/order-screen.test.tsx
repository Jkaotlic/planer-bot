// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { formatMoney } from "@planer/shared";
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
