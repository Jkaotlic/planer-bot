// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type SwapRequest, type WorkerCollection } from "./api/client";
import { App } from "./App";

/**
 * Метки на вкладках — не только чистая функция (`tab-badges.test.ts`) и не
 * только отрисовка (`tab-bar-badges.test.tsx`): без сквозного теста было
 * незамечено, что «Я перевёл» в `TeamCollections` не сообщал наверх и метка
 * на «Сборах» оставалась висеть после того, как человек уже отметился.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function bootstrapWith(over: { swaps?: SwapRequest[] } = {}) {
  return {
    me: {
      id: 1, displayName: "Аня", address: "Аня", preferredName: null,
      isAdmin: false, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
      isObserver: false, selfScheduleEnabled: false, canAnnounce: false,
    },
    myShifts: { shifts: [], today: "2026-09-25" },
    teamSchedule: { shifts: [], employees: [] },
    templates: [], swaps: [], weekendSlots: [], weekendOffers: [],
    ...over,
  };
}

const INCOMING_SWAP: SwapRequest = {
  id: 1,
  direction: "incoming",
  status: "pending",
  message: null,
  createdAt: "2026-09-20T10:00:00.000Z",
  counterpartyName: "Игорь",
  yourShift: null,
  theirShift: null,
};

const UNPAID_COLLECTION: WorkerCollection = {
  id: 1, title: "Кофемашина", personName: null, collectUrl: null,
  amountPerPerson: 1000, totalGoal: null, deadline: null, eventDate: null,
  paid: false, paidCount: 2, recipientCount: 5,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 20) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(App)));
  });
  await settle();
  return host;
}

/** Пункт бара по подписи — не точным совпадением: с меткой в тексте пункта
 *  появляется ещё и число, а для скринридера — фраза «ждёт ответа: N». */
function tabItem(el: HTMLElement, label: string): HTMLElement {
  return [...el.querySelectorAll(".tab-bar-fit button")].find((b) =>
    (b.textContent ?? "").includes(label),
  ) as HTMLElement;
}

function badgeOf(el: HTMLElement, label: string): Element | null {
  return tabItem(el, label).querySelector(".tab-badge");
}

describe("метки на TabBar реагируют на действия, а не только на bootstrap", () => {
  // У админа «Сборы» — консоль (`AdminCollections`), а не список с кнопкой
  // «Я перевёл»: метки там не бывает вовсе (`tabBadges` про `isAdmin` уже
  // знает), и запрос ради метки, которая никогда не нарисуется, — лишняя
  // поездка через медленный релей. Ни при старте, ни при фоновом обновлении
  // (смена вкладки) `getMyCollections` для админа звать не за чем.
  it("админ не получает запрос сборов вовсе — ни при старте, ни при фоновом обновлении", async () => {
    const admin = bootstrapWith();
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue({ ...admin, me: { ...admin.me, isAdmin: true } } as never);
    const getMyCollections = vi.spyOn(apiClient, "getMyCollections");

    const el = await mount();
    expect(getMyCollections).not.toHaveBeenCalled();

    await act(async () => tabItem(el, "Обмены").click());
    await settle();
    expect(getMyCollections).not.toHaveBeenCalled();
  });


  it("«Обмены»: принять входящий обмен убирает метку", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith({ swaps: [INCOMING_SWAP] }) as never);
    vi.spyOn(apiClient, "getMyCollections").mockResolvedValue([]);
    const getSwaps = vi.spyOn(apiClient, "getSwaps").mockResolvedValue([]);
    const acceptSwap = vi.spyOn(apiClient, "acceptSwap").mockResolvedValue(undefined);

    const el = await mount();
    expect((badgeOf(el, "Обмены")?.textContent ?? "").trim()).toBe("1");

    await act(async () => tabItem(el, "Обмены").click());
    await settle();

    const acceptButton = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Принять");
    expect(acceptButton, "кнопка «Принять» должна быть на экране «Обмены»").toBeTruthy();
    await act(async () => acceptButton!.click());
    await settle();

    expect(acceptSwap).toHaveBeenCalledWith(1);
    expect(getSwaps).toHaveBeenCalled();
    expect(badgeOf(el, "Обмены")).toBeNull();
  });

  it("«Сборы»: «Я перевёл» убирает метку сразу, без ожидания фонового обновления", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith() as never);
    // Мок продолжает отвечать «не оплачено» — метка должна пропасть от
    // локального обновления по ответу `setCollectionPaid`, а не от того, что
    // фоновый `getMyCollections` вдруг вернёт другие данные.
    vi.spyOn(apiClient, "getMyCollections").mockResolvedValue([UNPAID_COLLECTION]);
    const setCollectionPaid = vi
      .spyOn(apiClient, "setCollectionPaid")
      .mockResolvedValue({ paid: true, paidCount: 3, recipientCount: 5 });

    const el = await mount();
    expect((badgeOf(el, "Сборы")?.textContent ?? "").trim()).toBe("1");

    await act(async () => tabItem(el, "Сборы").click());
    await settle();

    const payButton = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Я перевёл"));
    expect(payButton, "кнопка «Я перевёл» должна быть на экране «Сборы»").toBeTruthy();
    await act(async () => payButton!.click());
    await settle();

    expect(setCollectionPaid).toHaveBeenCalledWith(1, true);
    expect(badgeOf(el, "Сборы")).toBeNull();
  });

  it("фоновое обновление сборов не даёт устаревшему ответу перезаписать более новый", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith() as never);
    const getMyCollections = vi.spyOn(apiClient, "getMyCollections");
    // Стартовая загрузка — без меток, чтобы дальше был виден только эффект гонки.
    getMyCollections.mockResolvedValueOnce([]);
    // Дальше — управляемые вручную промисы, как в `boot-retry.test.tsx`: порядок
    // разрешения задаёт тест, а не микротаск-очередь.
    const resolvers: Array<(value: WorkerCollection[]) => void> = [];
    getMyCollections.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));

    const el = await mount();
    expect(badgeOf(el, "Сборы")).toBeNull();

    // Первое фоновое обновление (смена вкладки на «Обмены») — доходит до своего
    // запроса сборов и там подвисает.
    await act(async () => tabItem(el, "Обмены").click());
    await settle();
    expect(resolvers).toHaveLength(1);

    // Второе, более новое обновление (смена вкладки на «Выходные») — тоже
    // доходит до своего запроса и тоже подвисает.
    await act(async () => tabItem(el, "Выходные").click());
    await settle();
    expect(resolvers).toHaveLength(2);

    // Более новый запрос отвечает первым — пятью неоплаченными сборами.
    await act(async () => {
      resolvers[1]!(Array.from({ length: 5 }, (_, i) => ({ ...UNPAID_COLLECTION, id: i + 1 })));
    });
    await settle();
    expect((badgeOf(el, "Сборы")?.textContent ?? "").trim()).toBe("5");

    // Более старый запрос отвечает вторым, с другим числом — без своего гейта
    // он переписал бы уже показанную свежую метку, хотя запущен раньше.
    await act(async () => {
      resolvers[0]!([UNPAID_COLLECTION]);
    });
    await settle();
    expect((badgeOf(el, "Сборы")?.textContent ?? "").trim()).toBe("5");
  });
});
