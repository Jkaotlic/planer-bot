// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthRequiredError, apiClient } from "../../api/client";
import { orderView, pollView } from "./food-fixtures";
import { button, click, mount, unmount, waitFor } from "./food-test-kit";
import { OrdersPollsScreen } from "./OrdersPollsScreen";

afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
});

const paid = (paidCount: number, total: number) => ({ myPaid: false, paidCount, total, rows: null });

describe("консоль: список «Заказы и опросы»", () => {
  it("идущие — сразу, прошедшие — свёрнуты; закрытый с несобранными деньгами ещё идёт", async () => {
    vi.spyOn(apiClient, "getOrders").mockResolvedValue([
      orderView({ id: 7, placeName: "Додо", creatorName: "Игорь", isCreator: false, closes: "до 12:30", myTotal: 1200 }),
      orderView({ id: 8, placeName: "Шаурмечная", open: false, closed: true, payment: paid(1, 3) }),
      orderView({ id: 9, placeName: "Суши", open: false, closed: true, payment: paid(2, 2) }),
    ]);
    vi.spyOn(apiClient, "getPolls").mockResolvedValue([pollView({ id: 3 }), pollView({ id: 4, question: "Пятница?", open: false })]);
    const el = await mount(OrdersPollsScreen, { onAuthRequired: vi.fn() });
    await waitFor(() => expect(el.textContent).toContain("Собирает Игорь · до 12:30"));
    expect(el.textContent).toContain("Твой заказ: 1\u00a0200\u00a0₽");
    expect(el.textContent).toContain("Шаурмечная");
    expect(el.textContent).not.toContain("Суши");
    expect(el.textContent).toContain("Обед?");
    expect(el.textContent).not.toContain("Пятница?");
    await click(button(el, "▸Прошедшие заказы · 1"));
    expect(el.textContent).toContain("Суши");
    await click(button(el, "▸Прошедшие опросы · 1"));
    expect(el.textContent).toContain("Пятница?");
  });

  it("заказы не загрузились — текст в своём разделе и «Повторить», опросы при этом видны", async () => {
    const getOrders = vi.spyOn(apiClient, "getOrders").mockRejectedValueOnce(new Error("Нет связи с сервером — проверь интернет и попробуй ещё раз."));
    getOrders.mockResolvedValueOnce([orderView()]);
    vi.spyOn(apiClient, "getPolls").mockResolvedValue([pollView()]);
    const el = await mount(OrdersPollsScreen, { onAuthRequired: vi.fn() });
    const orders = () => el.querySelector<HTMLElement>('section[aria-label="Заказы"]')!;
    await waitFor(() => expect(orders().querySelector('[role="alert"]')?.textContent).toContain("Нет связи с сервером"));
    expect(el.textContent).toContain("Обед?");
    await click(button(orders(), "Повторить"));
    await waitFor(() => expect(el.textContent).toContain("Додо"));
    expect(getOrders).toHaveBeenCalledTimes(2);
  });

  it("пусто — «Пока ничего не запускали.»", async () => {
    vi.spyOn(apiClient, "getOrders").mockResolvedValue([]);
    vi.spyOn(apiClient, "getPolls").mockResolvedValue([]);
    const el = await mount(OrdersPollsScreen, { onAuthRequired: vi.fn() });
    await waitFor(() => expect(el.textContent).toContain("Пока ничего не запускали."));
  });

  it("истёкшая сессия при загрузке — вход заново", async () => {
    vi.spyOn(apiClient, "getOrders").mockRejectedValue(new AuthRequiredError("Сессия истекла — войди заново"));
    vi.spyOn(apiClient, "getPolls").mockResolvedValue([]);
    const onAuth = vi.fn();
    await mount(OrdersPollsScreen, { onAuthRequired: onAuth });
    await waitFor(() => expect(onAuth).toHaveBeenCalled());
  });
});
