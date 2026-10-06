// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthRequiredError, apiClient } from "../../api/client";
import { orderView, pollView } from "./food-fixtures";
import { button, click, mount, type, unmount, waitFor } from "./food-test-kit";
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

  it("«🍱 Новый заказ» открывает форму, «Отмена» возвращает к списку и перечитывает его", async () => {
    const getOrders = vi.spyOn(apiClient, "getOrders").mockResolvedValue([]);
    vi.spyOn(apiClient, "getPolls").mockResolvedValue([]);
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([]);
    vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue([]);
    vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue([]);
    const el = await mount(OrdersPollsScreen, { onAuthRequired: vi.fn() });
    await waitFor(() => expect(el.textContent).toContain("Пока ничего не запускали."));
    await click(button(el, "🍱 Новый заказ"));
    expect(el.querySelector("h2")?.textContent).toBe("Новый заказ");
    await click(button(el, "Отмена"));
    await waitFor(() => expect(el.querySelector("h2")?.textContent).toBe("Заказы и опросы"));
    expect(getOrders).toHaveBeenCalledTimes(2);
  });

  it("«Открыть» ведёт на экран заказа, «‹ Назад» — обратно", async () => {
    vi.spyOn(apiClient, "getOrders").mockResolvedValue([orderView({ id: 7, placeName: "Додо" })]);
    vi.spyOn(apiClient, "getPolls").mockResolvedValue([]);
    const getOrder = vi.spyOn(apiClient, "getOrder").mockResolvedValue(orderView({ id: 7, placeName: "Додо" }));
    const el = await mount(OrdersPollsScreen, { onAuthRequired: vi.fn() });
    await waitFor(() => expect(el.textContent).toContain("Додо"));
    await click(button(el, "Открыть"));
    await waitFor(() => expect(el.querySelector("h2")?.textContent).toBe("🍱 Додо"));
    expect(getOrder).toHaveBeenCalledWith(7);
    await click(button(el, "‹ Назад"));
    await waitFor(() => expect(el.querySelector("h2")?.textContent).toBe("Заказы и опросы"));
  });

  it("«🗳 Новый опрос» открывает форму; созданный опрос виден в перечитанном списке", async () => {
    const getPolls = vi.spyOn(apiClient, "getPolls").mockResolvedValueOnce([]).mockResolvedValueOnce([pollView({ question: "Корпоратив?" })]);
    vi.spyOn(apiClient, "getOrders").mockResolvedValue([]);
    vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue([]);
    vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue([]);
    vi.spyOn(apiClient, "createPoll").mockResolvedValue({ poll: pollView({ question: "Корпоратив?" }), delivered: 2, unreachable: [] });
    const el = await mount(OrdersPollsScreen, { onAuthRequired: vi.fn() });
    await waitFor(() => expect(el.textContent).toContain("Пока ничего не запускали."));
    await click(button(el, "🗳 Новый опрос"));
    await type(el.querySelector<HTMLTextAreaElement>('textarea[aria-label="Вопрос"]')!, "Корпоратив?");
    await waitFor(() => expect(button(el, "Отправить").disabled).toBe(false));
    await click(button(el, "Отправить"));
    await waitFor(() => expect(el.textContent).toContain("Корпоратив?"));
    expect(el.querySelector("h2")?.textContent).toBe("Заказы и опросы");
    expect(getPolls).toHaveBeenCalledTimes(2);
  });

  it("«🍴 Места и меню» — из шапки и из формы заказа; «‹ Назад» — в список", async () => {
    vi.spyOn(apiClient, "getOrders").mockResolvedValue([]);
    vi.spyOn(apiClient, "getPolls").mockResolvedValue([]);
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([]);
    vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue([]);
    vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue([]);
    const el = await mount(OrdersPollsScreen, { onAuthRequired: vi.fn() });
    await waitFor(() => expect(el.textContent).toContain("Пока ничего не запускали."));
    await click(button(el, "🍴 Места и меню"));
    expect(el.querySelector("h2")?.textContent).toBe("Места и меню");
    await click(button(el, "‹ Назад"));
    await waitFor(() => expect(el.querySelector("h2")?.textContent).toBe("Заказы и опросы"));
    await click(button(el, "🍱 Новый заказ"));
    await click(button(el, "🍴 Места и меню"));
    expect(el.querySelector("h2")?.textContent).toBe("Места и меню");
  });
});
