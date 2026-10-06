// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthRequiredError, apiClient } from "../../api/client";
import { TEAM, orderView } from "./food-fixtures";
import { button, click, deferred, mount, type, unmount, waitFor } from "./food-test-kit";
import { OrderForm } from "./OrderForm";

beforeEach(() => {
  vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue(TEAM);
  vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue([]);
});
afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
});

const DODO = { id: 1, name: "Додо", menu: [{ id: 11, name: "Пицца", price: 1200 }] };
const props = () => ({ onDone: vi.fn(), onCancel: vi.fn(), onAuthRequired: vi.fn() });

describe("консоль: новый заказ", () => {
  it("место, комментарий, срок и адресаты уходят одним телом; без недошедших — сразу к заказу", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([DODO]);
    const create = vi.spyOn(apiClient, "createOrder").mockResolvedValue({ order: orderView({ id: 42 }), delivered: 2, unreachable: [] });
    const p = props();
    const el = await mount(OrderForm, p);
    await waitFor(() => expect(button(el, "Додо")).toBeTruthy());
    await click(button(el, "Додо"));
    expect(el.textContent).toContain("Пицца — 1\u00a0200\u00a0₽");
    await type(el.querySelector<HTMLTextAreaElement>('textarea[aria-label="Комментарий"]')!, "  к часу  ");
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Куда сдавать"]')!.getAttribute("type")).toBe("text");
    await type(el.querySelector<HTMLInputElement>('input[aria-label="Куда сдавать"]')!, "Наличкой Ане");
    await type(el.querySelector<HTMLInputElement>('input[aria-label="Приём до"]')!, "12:30");
    await waitFor(() => expect(el.textContent).toContain("Уйдёт:"));
    await click(button(el, "Разослать"));
    await waitFor(() => expect(p.onDone).toHaveBeenCalledWith(42));
    expect(create).toHaveBeenCalledWith({
      placeId: 1, note: "к часу", payHint: "Наличкой Ане", closesTime: "12:30", audience: { kind: "on_shift" },
    });
  });

  it("дошло не всем — отчёт с «ОК», и только потом к заказу", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([]);
    vi.spyOn(apiClient, "createOrder").mockResolvedValue({ order: orderView({ id: 42 }), delivered: 1, unreachable: ["Дима"] });
    const p = props();
    const el = await mount(OrderForm, p);
    await waitFor(() => expect(el.textContent).toContain("Уйдёт:"));
    await click(button(el, "Разослать"));
    await waitFor(() => expect(el.textContent).toContain("Отправлено: 1. Не дошло: Дима"));
    expect(p.onDone).not.toHaveBeenCalled();
    await click(button(el, "ОК"));
    expect(p.onDone).toHaveBeenCalledWith(42);
  });

  it("отказ сервера — под формой, рядом с «Разослать»; форма цела", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([]);
    vi.spyOn(apiClient, "createOrder").mockRejectedValue(new Error("Некому отправить: в списке никого, кроме тебя."));
    const el = await mount(OrderForm, props());
    await waitFor(() => expect(el.textContent).toContain("Уйдёт:"));
    await click(button(el, "Разослать"));
    await waitFor(() => expect(el.querySelector('[role="alert"]')).not.toBeNull());
    const alert = el.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.textContent).toBe("Некому отправить: в списке никого, кроме тебя.");
    // Отказ стоит прямо над рядом кнопок, а не наверху формы.
    expect(alert.nextElementSibling?.contains(button(el, "Разослать"))).toBe(true);
  });

  it("мест нет — подсказка, куда идти; «Выбрать» без галочек гасит «Разослать»", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([]);
    const el = await mount(OrderForm, props());
    await waitFor(() => expect(el.textContent).toContain("Мест пока нет — добавь через «🍴 Места и меню» или заказывай без меню."));
    await click(button(el, "Выбрать"));
    expect(button(el, "Разослать").disabled).toBe(true);
  });

  it("двойной клик по «Разослать», пока первый идёт, — один заказ, а не два", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([]);
    const slow = deferred<{ order: ReturnType<typeof orderView>; delivered: number; unreachable: string[] }>();
    const create = vi.spyOn(apiClient, "createOrder").mockReturnValue(slow.promise);
    const el = await mount(OrderForm, props());
    await waitFor(() => expect(el.textContent).toContain("Уйдёт:"));
    await click(button(el, "Разослать"));
    await click(button(el, "Отправляю…"));
    expect(create).toHaveBeenCalledTimes(1);
    slow.resolve({ order: orderView({ id: 42 }), delivered: 2, unreachable: [] });
  });

  it("истёкшая сессия при отправке — вход, а не красная плашка", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([]);
    vi.spyOn(apiClient, "createOrder").mockRejectedValue(new AuthRequiredError("Сессия истекла — войди заново"));
    const p = props();
    const el = await mount(OrderForm, p);
    await waitFor(() => expect(el.textContent).toContain("Уйдёт:"));
    await click(button(el, "Разослать"));
    await waitFor(() => expect(p.onAuthRequired).toHaveBeenCalled());
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });
});
