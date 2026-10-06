// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthRequiredError, realClient } from "./client";

/**
 * Консоль ходит в те же ручки, что мини-апп, — путь, метод и тело обязаны
 * совпасть с сервером (`server/src/http/routes/{orders,polls,food-places,team-audience}.ts`).
 * Таблица, а не 23 копии одного теста: пропущенный метод видно по строке
 * «каждый метод еды проверен» ниже.
 */

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function stubFetch(body: unknown, status = 200) {
  // Токен в хранилище, иначе клиент упрётся в отсутствие initData раньше сети.
  window.localStorage.setItem("adminToken", "token-for-the-test");
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

const P = { id: 3, question: "Обед?" };
const PL = { id: 4, name: "Додо", menu: [] };
const O = { id: 7, placeName: "Додо" };
const C = { id: 2, displayName: "Игорь", reachable: true, role: "worker", onShift: true };
const AUD = { kind: "team" } as const;
const PLACE = { name: "Додо", menu: [{ name: "Пицца", price: 600 }] };
const NEW_ORDER = { placeId: 4, note: null, payHint: null, closesTime: "12:30", audience: AUD };

type Case = { name: string; call: () => Promise<unknown>; method: string; path: string; body?: unknown; response: unknown; result: unknown };

const CASES: Case[] = [
  { name: "getTeamAudience", call: () => realClient.getTeamAudience(), method: "GET", path: "/api/team-audience", response: { candidates: [C] }, result: [C] },
  { name: "getPolls", call: () => realClient.getPolls(), method: "GET", path: "/api/polls", response: { polls: [P] }, result: [P] },
  { name: "getPoll", call: () => realClient.getPoll(3), method: "GET", path: "/api/polls/3", response: { poll: P }, result: P },
  { name: "createPoll", call: () => realClient.createPoll({ question: "Обед?", closesTime: null, audience: AUD }), method: "POST", path: "/api/polls", body: { question: "Обед?", closesTime: null, audience: AUD }, response: { poll: P, delivered: 2, unreachable: [] }, result: { poll: P, delivered: 2, unreachable: [] } },
  { name: "votePoll", call: () => realClient.votePoll(3, "for"), method: "POST", path: "/api/polls/3/vote", body: { choice: "for" }, response: { poll: P }, result: P },
  { name: "closePoll", call: () => realClient.closePoll(3), method: "POST", path: "/api/polls/3/close", body: {}, response: { poll: P }, result: P },
  { name: "cancelPoll", call: () => realClient.cancelPoll(3), method: "POST", path: "/api/polls/3/cancel", body: {}, response: { poll: P }, result: P },
  { name: "getFoodPlaces", call: () => realClient.getFoodPlaces(), method: "GET", path: "/api/food-places", response: { places: [PL] }, result: [PL] },
  { name: "saveFoodPlace", call: () => realClient.saveFoodPlace(null, PLACE), method: "POST", path: "/api/food-places", body: PLACE, response: { place: PL }, result: PL },
  { name: "saveFoodPlace", call: () => realClient.saveFoodPlace(4, PLACE), method: "PUT", path: "/api/food-places/4", body: PLACE, response: { place: PL }, result: PL },
  { name: "archiveFoodPlace", call: () => realClient.archiveFoodPlace(4), method: "DELETE", path: "/api/food-places/4", response: { ok: true }, result: undefined },
  { name: "getOrders", call: () => realClient.getOrders(), method: "GET", path: "/api/orders", response: { orders: [O] }, result: [O] },
  { name: "getOrder", call: () => realClient.getOrder(7), method: "GET", path: "/api/orders/7", response: { order: O }, result: O },
  { name: "createOrder", call: () => realClient.createOrder(NEW_ORDER), method: "POST", path: "/api/orders", body: NEW_ORDER, response: { order: O, delivered: 3, unreachable: ["Марк"] }, result: { order: O, delivered: 3, unreachable: ["Марк"] } },
  { name: "addOrderItem", call: () => realClient.addOrderItem(7, { menuItemId: 11 }), method: "POST", path: "/api/orders/7/items", body: { menuItemId: 11 }, response: { order: O }, result: O },
  { name: "setOrderItemQty", call: () => realClient.setOrderItemQty(7, 5, 2), method: "PATCH", path: "/api/orders/7/items/5", body: { qty: 2 }, response: { order: O }, result: O },
  { name: "removeOrderItem", call: () => realClient.removeOrderItem(7, 5), method: "DELETE", path: "/api/orders/7/items/5", response: { order: O }, result: O },
  { name: "declineOrder", call: () => realClient.declineOrder(7), method: "POST", path: "/api/orders/7/decline", body: {}, response: { order: O }, result: O },
  { name: "closeOrder", call: () => realClient.closeOrder(7), method: "POST", path: "/api/orders/7/close", body: {}, response: { order: O }, result: O },
  { name: "cancelOrder", call: () => realClient.cancelOrder(7), method: "POST", path: "/api/orders/7/cancel", body: {}, response: { order: O }, result: O },
  { name: "setOrderPaid", call: () => realClient.setOrderPaid(7, true), method: "POST", path: "/api/orders/7/paid", body: { paid: true }, response: { order: O }, result: O },
  { name: "setOrderPaymentFor", call: () => realClient.setOrderPaymentFor(7, 2, false), method: "POST", path: "/api/orders/7/payments/2", body: { paid: false }, response: { order: O }, result: O },
  { name: "remindOrderUnpaid", call: () => realClient.remindOrderUnpaid(7), method: "POST", path: "/api/orders/7/remind", body: {}, response: { delivered: 1, unpaid: 2, unreachable: ["Марк"] }, result: { delivered: 1, unpaid: 2, unreachable: ["Марк"] } },
];

describe("консоль: ручки заказов, опросов и мест", () => {
  it.each(CASES.map((c) => [`${c.name} ${c.method} ${c.path}`, c] as const))("%s", async (_label, c) => {
    const fetch = stubFetch(c.response);
    await expect(c.call()).resolves.toEqual(c.result);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(c.path);
    expect(init?.method ?? "GET").toBe(c.method);
    expect(init?.body === undefined ? undefined : JSON.parse(String(init.body))).toEqual(c.body);
  });

  it("каждый метод еды проверен строкой таблицы", () => {
    const FOOD = [
      "getTeamAudience", "getPolls", "getPoll", "createPoll", "votePoll", "closePoll", "cancelPoll",
      "getFoodPlaces", "saveFoodPlace", "archiveFoodPlace", "getOrders", "getOrder", "createOrder", "addOrderItem",
      "setOrderItemQty", "removeOrderItem", "declineOrder", "closeOrder", "cancelOrder", "setOrderPaid",
      "setOrderPaymentFor", "remindOrderUnpaid",
    ];
    expect([...new Set(CASES.map((c) => c.name))].sort()).toEqual([...FOOD].sort());
    for (const name of FOOD) expect(typeof (realClient as unknown as Record<string, unknown>)[name]).toBe("function");
  });

  // Сервер говорит «видишь, но нельзя» кодом 409 с причиной.
  // Причина обязана доехать до экрана текстом, а не превратиться в «Сессия
  // истекла» — консоль гасит сессию только на 401/403.
  it("409 «Приём уже закрыт.» — обычная ошибка с текстом сервера, сессия цела", async () => {
    stubFetch({ error: "Приём уже закрыт." }, 409);
    const failure = await realClient.closeOrder(7).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AuthRequiredError);
    expect((failure as Error).message).toBe("Приём уже закрыт.");
    expect(window.localStorage.getItem("adminToken")).toBe("token-for-the-test");
  });

  // Обратный случай к 409: 401/403 — это правда «сессия кончилась», и токен
  // обязан уйти, иначе экран крутил бы мёртвый вход.
  it.each([401, 403])("%i на ручке еды — «сессия истекла», токен сброшен", async (status) => {
    stubFetch({ error: "x" }, status);
    const failure = await realClient.getOrders().catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(AuthRequiredError);
    expect(window.localStorage.getItem("adminToken")).toBeNull();
  });

  it("404 «Заказ не найден.» — тоже текстом", async () => {
    stubFetch({ error: "Заказ не найден." }, 404);
    await expect(realClient.getOrder(999)).rejects.toThrow("Заказ не найден.");
  });
});
