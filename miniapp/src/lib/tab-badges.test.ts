import { describe, expect, it } from "vitest";
import type { SwapRequest, WeekendOffer, WorkerCollection } from "../api/client";
import { tabBadges } from "./tab-badges";

/**
 * Метки «ждёт тебя» на вкладках нижнего меню — что именно считается «ждёт»
 * решено здесь, один раз, а не на каждой вкладке по-своему.
 */

const TODAY = "2026-09-25";

function swap(over: Partial<SwapRequest> & { id: number }): SwapRequest {
  return {
    direction: "incoming",
    status: "pending",
    message: null,
    createdAt: "2026-09-20T10:00:00.000Z",
    counterpartyName: "Игорь",
    yourShift: null,
    theirShift: null,
    ...over,
  };
}

function offer(over: Partial<WeekendOffer["assignment"]> & { id: number }, date: string): WeekendOffer {
  return {
    assignment: { status: "offered", hours: 8, ...over },
    slot: {
      id: over.id,
      date,
      start: "10:00",
      end: "19:00",
      title: null,
      location: null,
      note: null,
      status: "assigned",
    },
  };
}

function collection(over: Partial<WorkerCollection> & { id: number; paid: boolean }): WorkerCollection {
  return {
    title: "Сбор",
    personName: "Марк",
    collectUrl: null,
    amountPerPerson: null,
    totalGoal: null,
    deadline: null,
    eventDate: null,
    paidCount: 0,
    recipientCount: 1,
    ...over,
  };
}

describe("tabBadges", () => {
  it("считает только входящие pending-обмены", () => {
    const swaps = [
      swap({ id: 1, direction: "incoming", status: "pending" }),
      swap({ id: 2, direction: "outgoing", status: "pending" }),
      swap({ id: 3, direction: "incoming", status: "accepted" }),
    ];
    expect(tabBadges({ swaps, weekendOffers: [], collections: null, today: TODAY })).toEqual({ swaps: 1 });
  });

  it("считает офферы `offered`, чья смена ещё не прошла", () => {
    const weekendOffers = [
      offer({ id: 1, status: "offered" }, "2026-09-26"), // завтра
      offer({ id: 2, status: "offered" }, "2026-09-24"), // вчера — отвечать поздно
      offer({ id: 3, status: "confirmed" }, "2026-09-27"), // уже ответили
    ];
    expect(tabBadges({ swaps: [], weekendOffers, collections: null, today: TODAY })).toEqual({ weekend: 1 });
  });

  it("считает неоплаченные сборы; `null` — вовсе без ключа", () => {
    const collections = [
      collection({ id: 1, paid: false }),
      collection({ id: 2, paid: false }),
      collection({ id: 3, paid: true }),
    ];
    expect(tabBadges({ swaps: [], weekendOffers: [], collections, today: TODAY })).toEqual({ collections: 2 });
    expect(tabBadges({ swaps: [], weekendOffers: [], collections: null, today: TODAY })).toEqual({});
  });

  it("всё по нулям — пустой объект, ноль не рисуется", () => {
    const swaps = [swap({ id: 1, direction: "outgoing", status: "pending" })];
    const weekendOffers = [offer({ id: 1, status: "confirmed" }, "2026-09-26")];
    const collections = [collection({ id: 1, paid: true })];
    expect(tabBadges({ swaps, weekendOffers, collections, today: TODAY })).toEqual({});
  });
});
