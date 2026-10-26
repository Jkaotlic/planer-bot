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

describe("createFoodMock: отчёт о рассылке — как у сервера", () => {
  // Сервер считает «дошло» только по коллегам — своё письмо создатель ответов не соберёт —
  // и отдаёт флаг deliveredToNobody. Мок, считавший создателя, показывал в DEV на одного
  // больше, а без флага его ответ расходился с контрактом сервера.
  it("опрос: «дошло» — коллеги с Telegram без создателя, флаг на месте", async () => {
    const { mock } = mockAs({ id: 1, isAdmin: true });
    const report = await mock.createPoll({ question: "Обед?", closesTime: null, audience: { kind: "picked", employeeIds: [2, 3] } });
    // Аня (сама) не в счёт; Игорь и Лена (копия наблюдателю) с Telegram, Марк — без.
    expect(report.delivered).toBe(2);
    expect(report.deliveredToNobody).toBe(false);
  });

  it("сбор: «дошло» — коллеги с Telegram без создателя, флаг на месте", async () => {
    const { mock } = mockAs({ id: 1, isAdmin: true });
    const report = await mock.createOrder({ placeId: null, note: null, payHint: null, closesTime: null, audience: { kind: "picked", employeeIds: [2, 3] } });
    expect(report.delivered).toBe(2);
    expect(report.deliveredToNobody).toBe(false);
  });

  it("опрос, как и сбор: кроме себя достучаться не до кого — тот же отказ, что у сервера (409)", async () => {
    // Только Аня и Марк без Telegram: наблюдателя с копией нет.
    const state = { employees: [PEOPLE[0]!, PEOPLE[2]!], me: { id: 1, isAdmin: true } };
    const mock = createFoodMock({ delayMs: 0, state, now: () => ({ date: "2026-10-06", time: "12:00" }) });
    await expect(mock.createPoll({ question: "Обед?", closesTime: null, audience: { kind: "team" } }))
      .rejects.toThrow("Некому отправить: в списке никого, кроме тебя.");
    await expect(mock.createOrder({ placeId: null, note: null, payHint: null, closesTime: null, audience: { kind: "team" } }))
      .rejects.toThrow("Некому отправить: в списке никого, кроме тебя.");
    expect(await mock.getPolls()).toEqual([]);
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
  it("опрос: срок позже «сейчас» — сегодня, раньше — завтра, как у сервера", async () => {
    const { mock } = mockAs({ id: 1, isAdmin: true }, { date: "2026-10-06", time: "23:30" });
    const { poll } = await mock.createPoll({ question: "Обед?", closesTime: "23:45", audience: { kind: "team" } });
    expect(poll.closes).toBe("до 23:45");
    expect(poll.open).toBe(true);
    const { poll: tomorrow } = await mock.createPoll({ question: "Ужин?", closesTime: "23:00", audience: { kind: "team" } });
    expect(tomorrow.closesAt).toBe("2026-10-07T23:00");
    expect(tomorrow.closes).toBe("до завтра, 23:00");
    expect(tomorrow.open).toBe(true);
  });

  it("заказ: время без даты — по-прежнему сегодня, прошедшее — тем же отказом, что у сервера", async () => {
    const { mock } = mockAs({ id: 1, isAdmin: true }, { date: "2026-10-06", time: "23:30" });
    await expect(mock.createOrder({ placeId: null, note: null, payHint: null, closesTime: "23:00", audience: { kind: "team" } })).rejects.toThrow(
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

  it("потолок количества — те же тексты, что у сервера: тап и правка у кг называют вес", async () => {
    const { mock } = mockAs({ id: 1, isAdmin: true });
    const place = await mock.saveFoodPlace(null, { name: "Рынок", menu: [{ name: "Икра", price: 2400, unit: "kg", stepGrams: 400 }] });
    const { order } = await mock.createOrder({ ...base, placeId: place.id, closesAt: null });
    let view = await mock.addOrderItem(order.id, { menuItemId: place.menu[0]!.id });
    for (let k = 1; k < 20; k += 1) view = await mock.addOrderItem(order.id, { menuItemId: place.menu[0]!.id });
    expect(view.myItems[0]!.qty).toBe(20);
    await expect(mock.addOrderItem(order.id, { menuItemId: place.menu[0]!.id })).rejects.toThrow("Больше 8 кг одной позиции не взять.");
    await expect(mock.setOrderItemQty(order.id, view.myItems[0]!.id, 21)).rejects.toThrow("Больше 8 кг одной позиции не взять.");
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

describe("createFoodMock: «Напомнить молчащим» — как POST /api/polls/:id/remind", () => {
  it("молчащие активные: «дошло» — с Telegram, без него — в unreachable; ответившие не считаются", async () => {
    const people: FoodMockPerson[] = [...PEOPLE.map((p) => ({ ...p }))];
    const state = { employees: people, me: { id: 1, isAdmin: false } };
    const mock = createFoodMock({ delayMs: 0, state, now: () => ({ date: "2026-10-06", time: "12:00" }) });
    // Адресаты: Аня (сама), Игорь, Марк (без Telegram), Лена (наблюдатель, копия).
    const { poll } = await mock.createPoll({ question: "Обед?", closesTime: null, audience: { kind: "picked", employeeIds: [2, 3] } });
    await mock.votePoll(poll.id, "for");
    // Лена ушла в архив — как у сервера, её уже не зовут.
    people[3] = { ...people[3]!, isActive: false };
    expect(await mock.remindPollSilent(poll.id)).toEqual({ delivered: 1, silent: 2, unreachable: ["Марк"] });
  });

  it("отказы — те же тексты и тот же порядок, что у сервера", async () => {
    const { state, mock } = mockAs({ id: 1, isAdmin: false });
    const { poll } = await mock.createPoll({ question: "Обед?", closesTime: null, audience: { kind: "team" } });
    state.me = { id: 2, isAdmin: false };
    await expect(mock.remindPollSilent(poll.id)).rejects.toThrow("Напомнить может только тот, кто запустил опрос.");
    state.me = { id: 1, isAdmin: false };
    await mock.cancelPoll(poll.id);
    await expect(mock.remindPollSilent(poll.id)).rejects.toThrow("Опрос отменён — напоминать не о чем.");
    const { poll: other } = await mock.createPoll({ question: "Ужин?", closesTime: null, audience: { kind: "team" } });
    await mock.closePoll(other.id);
    await expect(mock.remindPollSilent(other.id)).rejects.toThrow("Опрос закрыт — напоминать уже не о чем.");
  });
});

describe("createFoodMock: опрос — как сервер после архивации и при закрытии", () => {
  it("архивный адресат не стоит в итоге и не считается в адресатах — как pollRecipientRows", async () => {
    const people: FoodMockPerson[] = PEOPLE.map((p) => ({ ...p }));
    const state = { employees: people, me: { id: 1, isAdmin: false } };
    const mock = createFoodMock({ delayMs: 0, state, now: () => ({ date: "2026-10-06", time: "12:00" }) });
    const { poll } = await mock.createPoll({ question: "Обед?", closesTime: null, audience: { kind: "picked", employeeIds: [2, 3] } });
    expect(poll.tally.silent).toEqual(["Аня", "Игорь", "Марк", "Лена"]);
    people[1] = { ...people[1]!, isActive: false }; // Игорь ушёл в архив
    const after = await mock.getPoll(poll.id);
    expect(after.tally.silent).toEqual(["Аня", "Марк", "Лена"]);
    expect(after.recipientCount).toBe(3);
    // Вернули из архива — снова адресат, строка не удалялась.
    people[1] = { ...people[1]!, isActive: true };
    expect((await mock.getPoll(poll.id)).tally.silent).toContain("Игорь");
  });

  it("закрыть и отменить чужой — те же отказы, что у сервера; админ — может", async () => {
    const { state, mock } = mockAs({ id: 1, isAdmin: false });
    const { poll } = await mock.createPoll({ question: "Обед?", closesTime: null, audience: { kind: "team" } });
    state.me = { id: 2, isAdmin: false };
    await expect(mock.closePoll(poll.id)).rejects.toThrow("Закрыть может только тот, кто запустил опрос.");
    await expect(mock.cancelPoll(poll.id)).rejects.toThrow("Отменить может только тот, кто запустил опрос.");
    expect((await mock.getPoll(poll.id)).open).toBe(true);
    state.me = { id: 4, isAdmin: true };
    expect((await mock.closePoll(poll.id)).open).toBe(false);
  });

  it("повторное закрытие и отмена закрытого — «Опрос уже закрыт.»; закрыть отменённый — «Опрос отменён.»", async () => {
    const { mock } = mockAs({ id: 1, isAdmin: false });
    const { poll } = await mock.createPoll({ question: "Обед?", closesTime: null, audience: { kind: "team" } });
    await mock.closePoll(poll.id);
    await expect(mock.closePoll(poll.id)).rejects.toThrow("Опрос уже закрыт.");
    await expect(mock.cancelPoll(poll.id)).rejects.toThrow("Опрос уже закрыт.");
    expect((await mock.getPoll(poll.id)).cancelled).toBe(false);
    const { poll: other } = await mock.createPoll({ question: "Ужин?", closesTime: null, audience: { kind: "team" } });
    await mock.cancelPoll(other.id);
    await expect(mock.closePoll(other.id)).rejects.toThrow("Опрос отменён.");
    await expect(mock.cancelPoll(other.id)).rejects.toThrow("Опрос уже закрыт.");
  });
});
