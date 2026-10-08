// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { AuthRequiredError, apiClient } from "../../api/client";
import { TeamTodayContext } from "../../lib/team-today";
import { FOOD_TEXT_MAX } from "@planer/shared";
import { TEAM, orderView } from "./food-fixtures";
import { authRequired, button, click, deferred, release, mount, type, unmount, waitFor } from "./food-test-kit";
import { OrderForm } from "./OrderForm";

beforeEach(() => {
  vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue(TEAM);
  vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue([]);
});
afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
});

const DODO = { id: 1, name: "Додо", menu: [{ id: 11, name: "Пицца", price: 1200, unit: "pcs" as const, stepGrams: null }] };
// Командное «сегодня» задаём контекстом, а не часами: тест не должен зависеть от даты запуска.
function FormToday(p: Parameters<typeof OrderForm>[0]) {
  return createElement(TeamTodayContext.Provider, { value: "2030-01-15" }, createElement(OrderForm, p));
}
const input = (el: HTMLElement, label: string) => el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const props = () => ({ onDone: vi.fn(), onCancel: vi.fn() });

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
    await waitFor(() => expect(el.textContent).toContain("Уйдёт:"));
    await click(button(el, "Разослать"));
    await waitFor(() => expect(p.onDone).toHaveBeenCalledWith(42));
    expect(create).toHaveBeenCalledWith({
      placeId: 1, note: "к часу", payHint: "Наличкой Ане", title: null, allowCustom: true, closesAt: null, audience: { kind: "on_shift" },
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
    await release(slow, { order: orderView({ id: 42 }), delivered: 2, unreachable: [] });
  });

  it("истёкшая сессия при отправке — вход, а не красная плашка", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([]);
    vi.spyOn(apiClient, "createOrder").mockRejectedValue(new AuthRequiredError("Сессия истекла — войди заново"));
    const p = props();
    const el = await mount(OrderForm, p);
    await waitFor(() => expect(el.textContent).toContain("Уйдёт:"));
    await click(button(el, "Разослать"));
    await waitFor(() => expect(authRequired).toHaveBeenCalled());
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it("название, дата, время и запрет своих позиций уходят одним closesAt", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([DODO]);
    const create = vi.spyOn(apiClient, "createOrder").mockResolvedValue({ order: orderView({ id: 42 }), delivered: 2, unreachable: [] });
    const p = props();
    const el = await mount(FormToday, p);
    await waitFor(() => expect(button(el, "Додо")).toBeTruthy());
    await click(button(el, "Додо"));
    expect(input(el, "Название").maxLength).toBe(FOOD_TEXT_MAX);
    await type(input(el, "Название"), "  Икра, доставка 09.10 ");
    await type(input(el, "Дата приёма"), "2030-01-16");
    await type(input(el, "Приём до"), "16:00");
    await click(input(el, "Можно добавлять свои позиции"));
    await waitFor(() => expect(el.textContent).toContain("Уйдёт:"));
    await click(button(el, "Разослать"));
    await waitFor(() => expect(p.onDone).toHaveBeenCalledWith(42));
    expect(create).toHaveBeenCalledWith({
      placeId: 1, title: "Икра, доставка 09.10", allowCustom: false, note: null, payHint: null, closesAt: "2030-01-16T16:00", audience: { kind: "on_shift" },
    });
  });

  it("дата без времени — «Разослать» погашена, подсказка просит время; только время — сегодня", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([]);
    const create = vi.spyOn(apiClient, "createOrder").mockResolvedValue({ order: orderView({ id: 42 }), delivered: 2, unreachable: [] });
    const el = await mount(FormToday, props());
    await waitFor(() => expect(el.textContent).toContain("Уйдёт:"));
    await type(input(el, "Дата приёма"), "2030-01-16");
    expect(button(el, "Разослать").disabled).toBe(true);
    expect(el.textContent).toContain("Укажи и время");
    await type(input(el, "Дата приёма"), "");
    await type(input(el, "Приём до"), "23:30");
    expect(button(el, "Разослать").disabled).toBe(false);
    await click(button(el, "Разослать"));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ closesAt: "2030-01-15T23:30" }));
  });

  it("дата ограничена сегодня..+14 дней по командному календарю", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([]);
    const el = await mount(FormToday, props());
    expect(input(el, "Дата приёма").min).toBe("2030-01-15");
    expect(input(el, "Дата приёма").max).toBe("2030-01-29");
  });

  it("«Без меню» включает и запирает «свои позиции»: сбор, который сервер отклонит, не собрать", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([DODO]);
    const create = vi.spyOn(apiClient, "createOrder").mockResolvedValue({ order: orderView({ id: 42 }), delivered: 2, unreachable: [] });
    const el = await mount(FormToday, props());
    await waitFor(() => expect(button(el, "Додо")).toBeTruthy());
    await click(button(el, "Додо"));
    await click(input(el, "Можно добавлять свои позиции"));
    expect(input(el, "Можно добавлять свои позиции").checked).toBe(false);
    await click(button(el, "Без меню"));
    expect(input(el, "Можно добавлять свои позиции").checked).toBe(true);
    expect(input(el, "Можно добавлять свои позиции").disabled).toBe(true);
    await waitFor(() => expect(el.textContent).toContain("Уйдёт:"));
    await click(button(el, "Разослать"));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ placeId: null, allowCustom: true }));
  });
});
