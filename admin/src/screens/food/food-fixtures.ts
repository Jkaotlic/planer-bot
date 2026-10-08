import type { AudienceCandidate, OrderView, PollView } from "@planer/shared";

/** Заказ, который Аня собирает сама; поля меняются под случай теста. */
export function orderView(over: Partial<OrderView> = {}): OrderView {
  return {
    id: 7, creatorId: 1, creatorName: "Аня", placeId: 1, title: null, placeName: "Додо", allowCustom: true,
    menu: [{ id: 11, name: "Пицца", price: 600, unit: "pcs", stepGrams: null }], note: null, payHint: null, closesAt: null, closes: null,
    open: true, closed: false, cancelled: false, isCreator: true, canManage: true,
    myItems: [], myTotal: 0, declined: false, recipientCount: 4, respondedCount: 1,
    dishes: [], total: 0, people: [], payment: { myPaid: false, paidCount: 0, total: 0, rows: [] },
    ...over,
  };
}

export function pollView(over: Partial<PollView> = {}): PollView {
  return {
    id: 3, question: "Обед?", creatorId: 1, creatorName: "Аня", closesAt: null, closes: null,
    open: true, cancelled: false, isCreator: true, canManage: true, myChoice: null,
    tally: { for: [], against: [], abstain: [], silent: ["Игорь", "Марк"] }, recipientCount: 3,
    ...over,
  };
}

/** Игорь на смене; Марк нет; Дима на смене, но без Telegram; Лена — наблюдатель. */
export const TEAM: AudienceCandidate[] = [
  { id: 2, displayName: "Игорь", reachable: true, role: "worker", onShift: true },
  { id: 3, displayName: "Марк", reachable: true, role: "worker", onShift: false },
  { id: 4, displayName: "Дима", reachable: false, role: "worker", onShift: true },
  { id: 5, displayName: "Лена", reachable: true, role: "observer", onShift: false },
];
