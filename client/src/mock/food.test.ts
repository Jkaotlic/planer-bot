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
