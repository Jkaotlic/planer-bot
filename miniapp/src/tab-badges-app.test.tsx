// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type SwapRequest, type WorkerCollection } from "./api/client";
import { App } from "./App";
import { waitFor } from "./test-wait";

/**
 * Метки на вкладках — не только чистая функция (`tab-badges.test.ts`) и не
 * только отрисовка (`tab-bar-badges.test.tsx`): без сквозного теста было
 * незамечено, что «Я перевёл» в `TeamCollections` не сообщал наверх и метка
 * на «Сборах» оставалась висеть после того, как человек уже отметился.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Под нагрузкой полного набора ожидание условия длиннее обычного (ленивый чанк «Админ», перерисовки):
// таймаут теста не должен обрезать `waitFor`.
vi.setConfig({ testTimeout: 30_000 });

function bootstrapWith(over: { swaps?: SwapRequest[]; me?: Partial<ReturnType<typeof baseMe>> } = {}) {
  const { me, ...rest } = over;
  return {
    me: { ...baseMe(), ...me },
    myShifts: { shifts: [], today: "2026-09-25" },
    teamSchedule: { shifts: [], employees: [] },
    templates: [], swaps: [], weekendSlots: [], weekendOffers: [],
    ...rest,
  };
}

function baseMe() {
  return {
    id: 1, displayName: "Аня", address: "Аня", preferredName: null,
    isAdmin: false, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
    isObserver: false, selfScheduleEnabled: false, canAnnounce: false,
  };
}

const ADMIN_ME = { isAdmin: true };

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

/**
 * Витки очереди микрозадач, а не таймеры: нужны ТОЛЬКО перед утверждением «чего-то нет / не звали» —
 * оно проходило бы и до прихода ответа, а ждать наличия нечего. Всё, что должно ПОЯВИТЬСЯ,
 * ждётся через `waitFor` по самому утверждению.
 */
async function flush(times = 20) {
  for (let i = 0; i < times; i += 1) await act(async () => {});
}

async function mount() {
  // Сидовый мок держит одного ждущего ОК — без заглушки он перебил бы метку нехватки
  // во всех тестах ниже. Тесты про сами ожидания ставят своё значение до `mount`.
  if (!vi.isMockFunction(apiClient.getSickApprovals)) vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(App)));
  });
  // Бар нарисован — значит, `bootstrap` разобран; дальше метки ждёт сам тест.
  await waitFor(() => expect(host!.querySelector(".tab-bar-fit button")).not.toBeNull());
  await flush();
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
    const getBootstrap = vi.mocked(apiClient.getBootstrap);

    const el = await mount();
    expect(getMyCollections).not.toHaveBeenCalled();

    const loadsBefore = getBootstrap.mock.calls.length;
    await act(async () => tabItem(el, "Обмены").click());
    // Фоновое обновление действительно прошло (иначе «не звали» было бы пустой проверкой).
    await waitFor(() => expect(getBootstrap.mock.calls.length).toBeGreaterThan(loadsBefore));
    await flush();
    expect(getMyCollections).not.toHaveBeenCalled();
  });


  it("«Обмены»: принять входящий обмен убирает метку", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith({ swaps: [INCOMING_SWAP] }) as never);
    vi.spyOn(apiClient, "getMyCollections").mockResolvedValue([]);
    const getSwaps = vi.spyOn(apiClient, "getSwaps").mockResolvedValue([]);
    const acceptSwap = vi.spyOn(apiClient, "acceptSwap").mockResolvedValue(undefined);

    const el = await mount();
    await waitFor(() => expect((badgeOf(el, "Обмены")?.textContent ?? "").trim()).toBe("1"));

    await act(async () => tabItem(el, "Обмены").click());

    const findAccept = () => [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Принять");
    await waitFor(() => expect(findAccept(), "кнопка «Принять» должна быть на экране «Обмены»").toBeTruthy());
    await act(async () => findAccept()!.click());

    await waitFor(() => {
      expect(acceptSwap).toHaveBeenCalledWith(1);
      expect(getSwaps).toHaveBeenCalled();
      expect(badgeOf(el, "Обмены")).toBeNull();
    });
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
    await waitFor(() => expect((badgeOf(el, "Сборы")?.textContent ?? "").trim()).toBe("1"));

    await act(async () => tabItem(el, "Сборы").click());

    const findPay = () => [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Я перевёл"));
    await waitFor(() => expect(findPay(), "кнопка «Я перевёл» должна быть на экране «Сборы»").toBeTruthy());
    await act(async () => findPay()!.click());

    await waitFor(() => {
      expect(setCollectionPaid).toHaveBeenCalledWith(1, true);
      expect(badgeOf(el, "Сборы")).toBeNull();
    });
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
    await waitFor(() => expect(resolvers).toHaveLength(1));

    // Второе, более новое обновление (смена вкладки на «Выходные») — тоже
    // доходит до своего запроса и тоже подвисает.
    await act(async () => tabItem(el, "Выходные").click());
    await waitFor(() => expect(resolvers).toHaveLength(2));

    // Более новый запрос отвечает первым — пятью неоплаченными сборами.
    await act(async () => {
      resolvers[1]!(Array.from({ length: 5 }, (_, i) => ({ ...UNPAID_COLLECTION, id: i + 1 })));
    });
    await waitFor(() => expect((badgeOf(el, "Сборы")?.textContent ?? "").trim()).toBe("5"));

    // Более старый запрос отвечает вторым, с другим числом — без своего гейта
    // он переписал бы уже показанную свежую метку, хотя запущен раньше.
    await act(async () => {
      resolvers[0]!([UNPAID_COLLECTION]);
    });
    // Старый ответ разобран (его микрозадачи отработали) — и число прежнее.
    await flush();
    expect((badgeOf(el, "Сборы")?.textContent ?? "").trim()).toBe("5");
  });

  it("админ видит на «Админ» число нехватки", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith({ me: ADMIN_ME }) as never);
    vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 4, firstDate: "2026-09-26" });
    const el = await mount();
    await waitFor(() => expect((badgeOf(el, "Админ")?.textContent ?? "").trim()).toBe("4"));
  });

  const SICK_ROW = {
    id: 7, employeeId: 4, employeeName: "Даша", date: "2026-10-06", endDate: null,
    requestedAt: "2026-10-05T09:00:00.000Z", shiftLines: [], handoverForced: false,
  };

  it("ждущие ОК больничные главнее нехватки: на «Админ» их число", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith({ me: ADMIN_ME }) as never);
    vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 4, firstDate: "2026-09-26" });
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([SICK_ROW, { ...SICK_ROW, id: 8 }]);
    const el = await mount();
    await waitFor(() => expect((badgeOf(el, "Админ")?.textContent ?? "").trim()).toBe("2"));
  });

  it("ждущих спрашивают ПОСЛЕ нехватки, а не параллельно (один запрос за раз до релея)", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith({ me: ADMIN_ME }) as never);
    const order: string[] = [];
    vi.spyOn(apiClient, "getAdminShortfall").mockImplementation(async () => {
      order.push("shortfall:start");
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("shortfall:done");
      return { total: 4, firstDate: "2026-09-26" };
    });
    vi.spyOn(apiClient, "getSickApprovals").mockImplementation(async () => {
      order.push("approvals:start");
      return [];
    });
    await mount();
    await waitFor(() => expect(order).toEqual(["shortfall:start", "shortfall:done", "approvals:start"]));
  });

  it("в меню админки строка «На подтверждение» несёт своё число, а решение пересчитывает метки", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith({ me: ADMIN_ME }) as never);
    const getShortfall = vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 4, firstDate: "2026-09-26" });
    const getApprovals = vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([SICK_ROW]);
    const approve = vi.spyOn(apiClient, "approveSickLeave").mockResolvedValue();
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([]);
    vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ shifts: [], employees: [], calendar: [] } as never);
    const el = await mount();
    await act(async () => tabItem(el, "Админ").click());
    // «Админ» — ленивый чанк: его загрузка под нагрузкой самая долгая.
    await waitFor(() => expect(el.querySelector('button[aria-label="Разделы"]')).not.toBeNull());
    await act(async () => (el.querySelector('button[aria-label="Разделы"]') as HTMLElement).click());
    const findRow = () => [...el.querySelectorAll<HTMLElement>("button.ui-menu-row")].find((r) => r.textContent?.includes("На подтверждение"));
    await waitFor(() => expect(findRow()?.querySelector(".ui-menu-row__badge")?.textContent).toBe("1"));
    await act(async () => findRow()!.click());
    const findOk = () => [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("✅ ОК"));
    await waitFor(() => expect(findOk()).toBeTruthy());
    const before = getShortfall.mock.calls.length;
    getApprovals.mockResolvedValue([]);
    await act(async () => findOk()!.click());
    await waitFor(() => {
      expect(approve).toHaveBeenCalledWith(7);
      // Отказ удаляет запись — нехватка тоже могла измениться, поэтому перечитывается она,
      // а ждущие — вслед за ней; метка возвращается к числу нехватки.
      expect(getShortfall.mock.calls.length).toBeGreaterThan(before);
      expect((badgeOf(el, "Админ")?.textContent ?? "").trim()).toBe("4");
    });
  });

  it("запрос ждущих упал — метка снова про нехватку", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith({ me: ADMIN_ME }) as never);
    vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 4, firstDate: "2026-09-26" });
    vi.spyOn(apiClient, "getSickApprovals").mockRejectedValue(new Error("сеть"));
    const el = await mount();
    await waitFor(() => expect((badgeOf(el, "Админ")?.textContent ?? "").trim()).toBe("4"));
  });

  it("более медленный старый ответ про ждущих не затирает новый", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith({ me: ADMIN_ME }) as never);
    vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 0, firstDate: null });
    let releaseOld: (rows: unknown[]) => void = () => {};
    const get = vi.spyOn(apiClient, "getSickApprovals")
      .mockImplementationOnce(() => new Promise((resolve) => { releaseOld = resolve as never; }))
      .mockResolvedValue([SICK_ROW, { ...SICK_ROW, id: 8 }, { ...SICK_ROW, id: 9 }] as never);
    const el = await mount();
    // Возврат в приложение запускает второй круг; первый ответ всё ещё висит.
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => {
      expect(get).toHaveBeenCalledTimes(2);
      expect((badgeOf(el, "Админ")?.textContent ?? "").trim()).toBe("3");
    });
    await act(async () => { releaseOld([]); });
    // Старый ответ разобран (его микрозадачи отработали) — и число прежнее.
    await flush();
    expect((badgeOf(el, "Админ")?.textContent ?? "").trim()).toBe("3");
  });

  it("ручка упала — метки нет, приложение живо", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith({ me: ADMIN_ME }) as never);
    const getShortfall = vi.spyOn(apiClient, "getAdminShortfall").mockRejectedValue(new Error("сеть"));
    const el = await mount();
    await waitFor(() => expect(getShortfall).toHaveBeenCalled());
    await flush();
    expect(badgeOf(el, "Админ")).toBeNull();
    expect(el.textContent).toContain("Админ");
  });

  it("работнику ручку не зовём вовсе", async () => {
    const spy = vi.spyOn(apiClient, "getAdminShortfall");
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith() as never);
    vi.spyOn(apiClient, "getMyCollections").mockResolvedValue([]);
    await mount();
    expect(spy).not.toHaveBeenCalled();
  });

  it("правка графика пересчитывает метку: новая нехватка доходит без перезапуска", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith({ me: ADMIN_ME }) as never);
    const getShortfall = vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 4, firstDate: "2026-09-26" });
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([]);
    vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ shifts: [], employees: [], calendar: [] } as never);
    vi.spyOn(apiClient, "setCalendarDay").mockResolvedValue(undefined as never);
    const el = await mount();
    await act(async () => tabItem(el, "Админ").click());
    // «Расписание» — раздел меню админки.
    const findOpen = () => [...el.querySelectorAll<HTMLElement>("*")].find((n) => n.children.length === 0 && (n.textContent ?? "").trim() === "Расписание");
    await waitFor(() => expect(findOpen(), "пункт «Расписание» в меню админки").toBeTruthy());
    await act(async () => findOpen()!.click());
    const findMark = () => [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => /выходн/i.test(b.textContent ?? ""));
    await waitFor(() => expect(findMark()).toBeTruthy());
    const before = getShortfall.mock.calls.length;
    getShortfall.mockResolvedValue({ total: 1, firstDate: "2026-09-26" });
    await act(async () => findMark()!.click());
    await waitFor(() => {
      expect(getShortfall.mock.calls.length).toBeGreaterThan(before);
      expect((badgeOf(el, "Админ")?.textContent ?? "").trim()).toBe("1");
    });
  });

  it("firstDate из ответа доходит до плашки: строка «Ближайшая нехватка» ведёт в следующую неделю", async () => {
    // Сегодня пятница 25.09, неделя 21–27.09 закрыта, а нехватка — в понедельник 28.09.
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith({ me: ADMIN_ME }) as never);
    vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 3, firstDate: "2026-09-28" });
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([{
      templateId: 10, name: "Утро", category: "shift", accent: "gold", checklistIds: [], sendReminder: false, reminderText: null,
      coverage: [1, 0, 0, 0, 0, 0, 0], pool: [], preference: {},
    }] as never);
    vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({
      shifts: [{ id: 1, date: "2026-09-21", endDate: null, start: "08:00", end: "17:00", employeeId: 7, employeeName: "Аня",
        category: "shift", templateId: 10, title: "Утро", location: null, unrecognisedCode: null }],
      employees: [], calendar: [],
    } as never);
    const el = await mount();
    await act(async () => tabItem(el, "Админ").click());
    const findOpen = () => [...el.querySelectorAll<HTMLElement>("*")].find((n) => n.children.length === 0 && (n.textContent ?? "").trim() === "Расписание");
    await waitFor(() => expect(findOpen()).toBeTruthy());
    await act(async () => findOpen()!.click());
    await waitFor(() => {
      expect(el.querySelector("[data-shortfall]")?.getAttribute("data-shortfall")).toBe("closed");
      expect(el.querySelector("[data-nearest-shortfall]")?.textContent).toBe("Ближайшая нехватка: Пн 28 — показать →");
    });
  });

  /** Возврат в приложение: `reloadData` слушает `visibilitychange`. */
  async function backToApp() {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  it("возврат в приложение перечитывает нехватку, и метка обновляется", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith({ me: ADMIN_ME }) as never);
    const getShortfall = vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 4, firstDate: "2026-09-26" });
    const el = await mount();
    await waitFor(() => expect((badgeOf(el, "Админ")?.textContent ?? "").trim()).toBe("4"));
    expect(getShortfall).toHaveBeenCalledTimes(1);

    getShortfall.mockResolvedValue({ total: 2, firstDate: "2026-09-26" });
    await backToApp();
    await waitFor(() => {
      expect(getShortfall).toHaveBeenCalledTimes(2);
      expect((badgeOf(el, "Админ")?.textContent ?? "").trim()).toBe("2");
    });
  });

  it("отказ при перечитывании снимает метку, а не оставляет устаревшее число", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith({ me: ADMIN_ME }) as never);
    const getShortfall = vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 4, firstDate: "2026-09-26" });
    const el = await mount();
    await waitFor(() => expect((badgeOf(el, "Админ")?.textContent ?? "").trim()).toBe("4"));

    getShortfall.mockRejectedValue(new Error("сеть"));
    await backToApp();
    await waitFor(() => {
      expect(getShortfall).toHaveBeenCalledTimes(2);
      expect(badgeOf(el, "Админ")).toBeNull();
    });
  });

  it("медленный старый ответ нехватки не затирает новое число", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith({ me: ADMIN_ME }) as never);
    const getShortfall = vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValueOnce({ total: 4, firstDate: null });
    const resolvers: Array<(v: { total: number; firstDate: string | null }) => void> = [];
    getShortfall.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    const el = await mount();

    await backToApp();
    await waitFor(() => expect(resolvers).toHaveLength(1));
    await backToApp();
    await waitFor(() => expect(resolvers).toHaveLength(2));

    await act(async () => resolvers[1]!({ total: 1, firstDate: null }));
    await waitFor(() => expect((badgeOf(el, "Админ")?.textContent ?? "").trim()).toBe("1"));
    // Более старый запрос отвечает последним, с другим числом.
    await act(async () => resolvers[0]!({ total: 9, firstDate: null }));
    await flush();
    expect((badgeOf(el, "Админ")?.textContent ?? "").trim()).toBe("1");
  });
});
