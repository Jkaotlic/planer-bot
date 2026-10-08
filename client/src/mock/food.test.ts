import { describe, expect, it, vi } from "vitest";
import { createFoodMock, type FoodMockPerson } from "./food";

const PEOPLE: FoodMockPerson[] = [
  { id: 1, displayName: "Аня", isActive: true, isAdmin: true, isObserver: false, telegramUserId: 101 },
  { id: 2, displayName: "Игорь", isActive: true, isAdmin: false, isObserver: false, telegramUserId: 102 },
  { id: 3, displayName: "Марк", isActive: true, isAdmin: false, isObserver: false, telegramUserId: null },
  { id: 4, displayName: "Лена", isActive: true, isAdmin: false, isObserver: true, telegramUserId: 104 },
  { id: 5, displayName: "Вера", isActive: true, isAdmin: false, isObserver: true, telegramUserId: null },
];

function mockAs(me: { id: number; isAdmin: boolean }, now = { date: "2026-10-06", time: "12:00" }) {
  const state = { employees: PEOPLE, me };
  return { state, mock: createFoodMock({ delayMs: 0, state, now: () => now }) };
}

describe("createFoodMock: «кто я» — из состояния морды", () => {
  it("кандидаты — без самого себя, с ролью и «дойдёт ли»", async () => {
    const { mock } = mockAs({ id: 2, isAdmin: false });
    const people = await mock.getTeamAudience();
    expect(people.map((p) => p.displayName)).toEqual(["Аня", "Марк", "Лена", "Вера"]);
    expect(people.find((p) => p.displayName === "Лена")).toMatchObject({ role: "observer", reachable: true });
  });

  it("опрос, созданный Игорем, — его; Аня-админ может закрыть чужой, Марк — нет", async () => {
    const { state, mock } = mockAs({ id: 2, isAdmin: false });
    const { poll } = await mock.createPoll({ question: "Обед?", closesTime: null, audience: { kind: "team" } });
    expect(poll).toMatchObject({ creatorName: "Игорь", isCreator: true, canManage: true });
    state.me = { id: 1, isAdmin: true };
    expect(await mock.getPoll(poll.id)).toMatchObject({ isCreator: false, canManage: true });
    state.me = { id: 3, isAdmin: false };
    expect(await mock.getPoll(poll.id)).toMatchObject({ isCreator: false, canManage: false });
  });

  it("админ видит «кто сколько» у чужого заказа, участник — нет", async () => {
    const { state, mock } = mockAs({ id: 2, isAdmin: false });
    const { order } = await mock.createOrder({ placeId: null, note: null, payHint: null, closesTime: null, audience: { kind: "team" } });
    state.me = { id: 1, isAdmin: true };
    expect((await mock.getOrder(order.id)).people).not.toBeNull();
    state.me = { id: 3, isAdmin: false };
    expect((await mock.getOrder(order.id)).people).toBeNull();
  });
});

describe("createFoodMock: копия наблюдателям — как resolveAudience сервера", () => {
  it("наблюдатель с Telegram получает копию при «Выбрать»; без Telegram — нет", async () => {
    const { mock } = mockAs({ id: 1, isAdmin: true });
    const { poll } = await mock.createPoll({ question: "Обед?", closesTime: null, audience: { kind: "picked", employeeIds: [2] } });
    // Аня (сама), Игорь (выбран), Лена (копия). Вера — наблюдатель без Telegram, её не звали.
    expect(poll.recipientCount).toBe(3);
    expect(poll.tally.silent.sort()).toEqual(["Аня", "Игорь", "Лена"]);
  });
});

describe("createFoodMock: «сейчас» — снаружи", () => {
  it("срок позже «сейчас» принимается, раньше — тем же отказом, что у сервера", async () => {
    const { mock } = mockAs({ id: 1, isAdmin: true }, { date: "2026-10-06", time: "23:30" });
    const { poll } = await mock.createPoll({ question: "Обед?", closesTime: "23:45", audience: { kind: "team" } });
    expect(poll.closes).toBe("до 23:45");
    expect(poll.open).toBe(true);
    await expect(mock.createPoll({ question: "Обед?", closesTime: "23:00", audience: { kind: "team" } })).rejects.toThrow(
      "Время уже прошло — поставь позже или оставь пустым.",
    );
  });

  // Не через `process.env.TZ` (он подхватывается на ходу не в каждом пуле
  // vitest): у даты в UTC подменён `toISOString`, и если мок снова возьмёт
  // дату оттуда, а не из местных частей, срок уедет на «1999-01-01».
  it("по умолчанию «сегодня» — местная дата, а не UTC", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 6, 12, 0));
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue("1999-01-01T00:00:00.000Z");
    try {
      const mock = createFoodMock({ delayMs: 0, state: { employees: PEOPLE, me: { id: 1, isAdmin: true } } });
      const { poll } = await mock.createPoll({ question: "Обед?", closesTime: "23:59", audience: { kind: "team" } });
      expect(poll.closesAt).toBe("2026-10-06T23:59");
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });
});

describe("createFoodMock: сбор — название, срок на дату, свои позиции", () => {
  const base = { note: null, payHint: null, audience: { kind: "team" as const } };

  it("closesAt, title и allowCustom доходят до вида заказа; свои позиции при запрете отклоняются", async () => {
    const { mock } = mockAs({ id: 1, isAdmin: true });
    const { order } = await mock.createOrder({ ...base, placeId: 1, title: " Икра, доставка 09.10 ", allowCustom: false, closesAt: "2026-10-09T16:00" });
    expect(order).toMatchObject({ title: "Икра, доставка 09.10", allowCustom: false, closesAt: "2026-10-09T16:00" });
    await expect(mock.addOrderItem(order.id, { name: "Суп", price: 100 })).rejects.toThrow("В этом сборе только позиции из списка.");
  });

  it("closesAt и closesTime вместе — отказ, как у сервера", async () => {
    const { mock } = mockAs({ id: 1, isAdmin: true });
    await expect(mock.createOrder({ ...base, placeId: null, closesAt: "2026-10-09T16:00", closesTime: "23:59" })).rejects.toThrow("Проверь место, срок и адресатов.");
  });

  it("срок проверяется как на сервере: формат и настоящий календарь, потом прошлое", async () => {
    const { mock } = mockAs({ id: 1, isAdmin: true });
    for (const bad of ["2026-10-09 16:00", "2026-10-09T24:00", "2026-09-31T10:00"]) {
      await expect(mock.createOrder({ ...base, placeId: null, closesAt: bad })).rejects.toThrow("Проверь место, срок и адресатов.");
    }
    await expect(mock.createOrder({ ...base, placeId: null, closesAt: "2026-10-06T11:00" })).rejects.toThrow("Время уже прошло");
  });

  it("отказы как у сервера: без меню и без своих позиций, срок за горизонтом", async () => {
    const { mock } = mockAs({ id: 1, isAdmin: true });
    await expect(mock.createOrder({ ...base, placeId: null, allowCustom: false, closesAt: null })).rejects.toThrow("Без меню нужны свои позиции");
    await expect(mock.createOrder({ ...base, placeId: null, closesAt: "2026-10-21T10:00" })).rejects.toThrow("Срок — не дальше 14 дней.");
  });
});

describe("createFoodMock: склейка строк как на сервере", () => {
  const base = { note: null, payHint: null, audience: { kind: "team" as const } };

  it("шаг поменяли посреди приёма — новый тап даёт новую строку, а не молча переписывает вес", async () => {
    const { mock } = mockAs({ id: 1, isAdmin: true });
    const place = await mock.saveFoodPlace(null, { name: "Рынок", menu: [{ name: "Икра", price: 2400, unit: "kg", stepGrams: 400 }] });
    const { order } = await mock.createOrder({ ...base, placeId: place.id, closesAt: null });
    await mock.addOrderItem(order.id, { menuItemId: place.menu[0]!.id });
    await mock.saveFoodPlace(place.id, { name: "Рынок", menu: [{ id: place.menu[0]!.id, name: "Икра", price: 2400, unit: "kg", stepGrams: 500 }] });
    const view = await mock.addOrderItem(order.id, { menuItemId: place.menu[0]!.id });
    expect(view.dishes.map((d) => [d.qty, d.stepGrams])).toEqual([[1, 400], [1, 500]]);
  });

  it("people[].items — свёрнутая сводка, как у сервера: две одинаковые свои строки — одна с количеством", async () => {
    const { mock } = mockAs({ id: 1, isAdmin: true });
    const { order } = await mock.createOrder({ ...base, placeId: null, closesAt: null });
    await mock.addOrderItem(order.id, { name: "Суп", price: 100 });
    const view = await mock.addOrderItem(order.id, { name: "Суп", price: 100 });
    const mine = view.people!.find((p) => p.employeeId === 1)!;
    expect(mine.items).toEqual([{ name: "Суп", price: 100, qty: 2, unit: "pcs", stepGrams: null }]);
  });

  it("место с пустым меню и запрет своих позиций — сбор отклонён, как у сервера", async () => {
    const { mock } = mockAs({ id: 1, isAdmin: true });
    const place = await mock.saveFoodPlace(null, { name: "Пустое", menu: [] });
    await expect(mock.createOrder({ ...base, placeId: place.id, allowCustom: false, closesAt: null })).rejects.toThrow("Без меню нужны свои позиции");
    await expect(mock.createOrder({ ...base, placeId: place.id, allowCustom: true, closesAt: null })).resolves.toBeTruthy();
  });
});
