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

  // Детерминированно, а не «когда даты расходятся»: Node подхватывает смену
  // `process.env.TZ` на ходу, а 22:30 UTC — это уже завтра по Москве.
  it("по умолчанию «сегодня» — местная дата, а не UTC", async () => {
    const tz = process.env.TZ;
    process.env.TZ = "Europe/Moscow";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T22:30:00Z"));
    try {
      const mock = createFoodMock({ delayMs: 0, state: { employees: PEOPLE, me: { id: 1, isAdmin: true } } });
      const { poll } = await mock.createPoll({ question: "Обед?", closesTime: "23:59", audience: { kind: "team" } });
      expect(poll.closesAt).toBe("2026-10-07T23:59");
    } finally {
      vi.useRealTimers();
      process.env.TZ = tz;
    }
  });
});

describe("createFoodMock: отказы — текстом сервера", () => {
  it("несуществующий заказ — «Заказ не найден.», как у GET /api/orders/:id", async () => {
    const { mock } = mockAs({ id: 1, isAdmin: true });
    await expect(mock.getOrder(999_999)).rejects.toThrow("Заказ не найден.");
    await expect(mock.getOrder(999_999)).rejects.not.toThrow("недоступен");
  });
});
