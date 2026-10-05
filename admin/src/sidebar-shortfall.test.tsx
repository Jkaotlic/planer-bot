// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminShortfall } from "@planer/shared";
import { AuthRequiredError, apiClient } from "./api/client";
import { App } from "./App";
import { waitFor } from "./test-wait";

/**
 * Число нехватки на пункте «Расписание» сайдбара — проводка от ручки до метки.
 * Метка существует ради того, чтобы дыру в графике было видно, не открывая
 * расписания; поэтому здесь важны и «нет метки при нуле», и «ручка упала».
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Под нагрузкой полного набора ожидание условия длиннее обычного: таймаут теста не должен обрезать `waitFor`.
vi.setConfig({ testTimeout: 30_000 });

let root: Root | null = null;
let host: HTMLDivElement | null = null;

// Мок-данные содержат ждущий больничный, и без заглушки метка «На подтверждение»
// появлялась бы в каждом кейсе про нехватку.
beforeEach(() => {
  vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([]);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

/**
 * Микрозадачи, а не таймеры: ответы мок-ручек — готовые промисы, и им нужны лишь витки очереди,
 * чтобы экран их разобрал. Это нужно ТОЛЬКО перед утверждением «чего-то нет» (метки, вызова):
 * такое утверждение проходило бы и до прихода ответа, а ждать наличия нечего.
 */
async function flush(times = 10) {
  for (let i = 0; i < times; i += 1) await act(async () => {});
}

/** Ручка вызвана не меньше `n` раз, и её ответ уже разобран экраном. */
async function called(spy: { mock: { calls: unknown[] } }, n = 1) {
  await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThanOrEqual(n));
  await flush();
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(App));
  });
  // Экран нарисован (расписание или вход), обе ручки метки уже позваны и разобраны.
  await waitFor(() => expect(host!.querySelector(".schedule-table, .login-screen")).not.toBeNull());
  await called(vi.mocked(apiClient.getAdminShortfall));
  await called(vi.mocked(apiClient.getSickApprovals));
  return host;
}

const badge = (el: HTMLElement) => el.querySelector(".sidebar-nav-badge");
const navButton = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLButtonElement>(".sidebar-nav-item")].find((b) => (b.textContent ?? "").includes(label))!;

describe("метка нехватки в сайдбаре", () => {
  it("нехватка — число на пункте «Расписание»", async () => {
    vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 4, firstDate: "2026-08-26" });
    const el = await mount();
    await waitFor(() => expect(badge(el)?.textContent).toBe("4"));
    expect(badge(el)?.closest("button")?.textContent).toContain("Расписание");
  });

  it("нет дыр — метки нет", async () => {
    vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 0, firstDate: null });
    expect(badge(await mount())).toBeNull();
  });

  it("ручка упала — метки нет, расписание открыто", async () => {
    vi.spyOn(apiClient, "getAdminShortfall").mockRejectedValue(new Error("сеть"));
    const el = await mount();
    expect(badge(el)).toBeNull();
    expect(el.querySelector(".schedule-table")).not.toBeNull();
  });

  it("сессия истекла (401/403) — экран входа, а не молча пропавшая метка", async () => {
    // Остальные вызовы консоли так и делают; тихая метка оставляла бы вкладку,
    // на которой следующая же правка падает.
    vi.spyOn(apiClient, "getAdminShortfall").mockRejectedValue(new AuthRequiredError("auth"));
    const el = await mount();
    expect(el.querySelector(".login-screen")).not.toBeNull();
  });

  it("сохранение нормы на «Видах смен» обновляет число, не уходя с экрана", async () => {
    // Метка видна на любом экране: пока админ правит норму, число должно
    // отражать её, а не то, что было при заходе.
    const getShortfall = vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 4, firstDate: "2026-08-26" });
    vi.spyOn(apiClient, "setTemplateCoverage").mockResolvedValue(undefined);
    const el = await mount();
    await act(async () => navButton(el, "Виды смен").click());
    await waitFor(() => expect(el.querySelector(".kind-card-head")).not.toBeNull());
    const before = getShortfall.mock.calls.length;
    getShortfall.mockResolvedValue({ total: 1, firstDate: "2026-08-26" });
    await act(async () => (el.querySelector(".kind-card-head") as HTMLButtonElement).click());
    await waitFor(() => expect(el.querySelector('input[aria-label$=": норма на Пн"]')).not.toBeNull());
    const field = el.querySelector<HTMLInputElement>('input[aria-label$=": норма на Пн"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "5");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Сохранить норму")!;
    await act(async () => save.click());
    await waitFor(() => {
      expect(el.querySelector(".kinds-intro")).not.toBeNull();
      expect(getShortfall.mock.calls.length).toBeGreaterThan(before);
      expect(badge(el)?.textContent).toBe("1");
    });
  });

  it("больше девяти — «9+»", async () => {
    vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 23, firstDate: "2026-08-26" });
    const el = await mount();
    await waitFor(() => expect(badge(el)?.textContent).toBe("9+"));
  });

  it("граница: девять — «9», десять — «9+»", async () => {
    const spy = vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 9, firstDate: "2026-08-26" });
    const el = await mount();
    await waitFor(() => expect(badge(el)?.textContent).toBe("9"));
    spy.mockResolvedValue({ total: 10, firstDate: "2026-08-26" });
    await act(async () => navButton(el, "Работники").click());
    await act(async () => navButton(el, "Расписание").click());
    await waitFor(() => expect(badge(el)?.textContent).toBe("9+"));
  });

  it("позднее обновление упало — прежнее число не остаётся", async () => {
    const spy = vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 4, firstDate: "2026-08-26" });
    const el = await mount();
    await waitFor(() => expect(badge(el)?.textContent).toBe("4"));
    spy.mockRejectedValue(new Error("сеть"));
    await act(async () => navButton(el, "Работники").click());
    await act(async () => navButton(el, "Расписание").click());
    // Метка пропадает по отказу: ждём именно этого, а не просто «прошло время».
    await waitFor(() => expect(badge(el)).toBeNull());
  });

  it("возврат во вкладку перечитывает число; после размонтирования слушателя нет", async () => {
    const spy = vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 4, firstDate: "2026-08-26" });
    const el = await mount();
    const before = spy.mock.calls.length;
    spy.mockResolvedValue({ total: 6, firstDate: "2026-08-26" });
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush();
    expect(spy.mock.calls.length).toBe(before);
    visibility.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => {
      expect(spy.mock.calls.length).toBe(before + 1);
      expect(badge(el)?.textContent).toBe("6");
    });
    await act(async () => root!.unmount());
    root = null;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(spy.mock.calls.length).toBe(before + 1);
  });

  it("экранному диктору число зачитывается словами, а сама метка скрыта от него", async () => {
    vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 4, firstDate: "2026-08-26" });
    const el = await mount();
    await waitFor(() => expect(badge(el)?.getAttribute("aria-hidden")).toBe("true"));
    expect(navButton(el, "Расписание").querySelector(".visually-hidden")?.textContent).toContain("не хватает людей: 4");
  });

  it("запоздавший старый ответ не затирает новое число", async () => {
    // Первый запрос (при открытии консоли) отвечает последним, уже после того,
    // как человек ушёл с «Расписания» и вернулся, — и должен быть отброшен.
    let resolveOld!: (value: AdminShortfall) => void;
    const spy = vi.spyOn(apiClient, "getAdminShortfall")
      .mockImplementationOnce(() => new Promise<AdminShortfall>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValue({ total: 4, firstDate: "2026-08-26" });
    const el = await mount();
    expect(badge(el)).toBeNull();
    await act(async () => navButton(el, "Виды смен").click());
    await act(async () => navButton(el, "Расписание").click());
    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(2);
      expect(badge(el)?.textContent).toBe("4");
    });
    await act(async () => resolveOld({ total: 1, firstDate: "2026-08-24" }));
    // Старый ответ разобран (его микрозадачи отработали), и число прежнее.
    await flush();
    expect(badge(el)?.textContent).toBe("4");
  });

  it("по возвращении на «Расписание» число перечитывается", async () => {
    // Нормы правят на «Видах смен», а число в сайдбаре считает по ним.
    const spy = vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 4, firstDate: "2026-08-26" });
    const el = await mount();
    spy.mockResolvedValue({ total: 2, firstDate: "2026-08-26" });
    await act(async () => navButton(el, "Работники").click());
    await act(async () => navButton(el, "Расписание").click());
    await waitFor(() => expect(badge(el)?.textContent).toBe("2"));
  });

  it("после удаления записи число перечитывается", async () => {
    // Все правки записей кончаются в `refreshSchedule`; удаление — самая короткая.
    const spy = vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 4, firstDate: "2026-08-26" });
    vi.spyOn(apiClient, "deleteEntry").mockResolvedValue({ notified: { sent: 0, failed: 0 } } as never);
    const el = await mount();
    const chip = el.querySelector<HTMLButtonElement>(".entry-chip");
    expect(chip, "в мок-графике нет ни одной записи на показанной неделе").not.toBeNull();
    await act(async () => chip!.click());
    spy.mockResolvedValue({ total: 3, firstDate: "2026-08-26" });
    const byText = (text: string) => [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim() === text)!;
    await act(async () => byText("Удалить").click());
    await act(async () => byText("Да, удалить").click());
    await waitFor(() => expect(badge(el)?.textContent).toBe("3"));
  });

  it("ждущие ОК — своя метка на «На подтверждение» и своя подсказка для читалки", async () => {
    vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 0, firstDate: null });
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([
      { id: 7, employeeId: 4, employeeName: "Даша", date: "2026-10-06", endDate: null, requestedAt: "2026-10-05T09:00:00.000Z", shiftLines: [], handoverForced: false },
    ]);
    const el = await mount();
    const item = navButton(el, "На подтверждение");
    await waitFor(() => expect(item.querySelector(".sidebar-nav-badge")?.textContent).toBe("1"));
    expect(item.textContent).toContain("ждут подтверждения: 1");
    expect(navButton(el, "Расписание").querySelector(".sidebar-nav-badge")).toBeNull();
  });

  it("ручка ждущих упала — метки нет; сессия истекла — экран входа", async () => {
    const spy = vi.spyOn(apiClient, "getSickApprovals").mockRejectedValue(new Error("сеть"));
    vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 0, firstDate: null });
    const el = await mount();
    expect(navButton(el, "На подтверждение").querySelector(".sidebar-nav-badge")).toBeNull();
    await act(async () => root!.unmount());
    host?.remove();
    spy.mockRejectedValue(new AuthRequiredError("auth"));
    const el2 = await mount();
    await waitFor(() => expect(el2.querySelector(".login-screen")).not.toBeNull());
  });

  it("возврат во вкладку перечитывает ждущих", async () => {
    vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 0, firstDate: null });
    const spy = vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([]);
    const el = await mount();
    spy.mockResolvedValue([
      { id: 7, employeeId: 4, employeeName: "Даша", date: "2026-10-06", endDate: null, requestedAt: "2026-10-05T09:00:00.000Z", shiftLines: [], handoverForced: false },
    ]);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => expect(navButton(el, "На подтверждение").querySelector(".sidebar-nav-badge")?.textContent).toBe("1"));
  });

  it("запоздавший старый ответ о ждущих не затирает новый", async () => {
    // Первый запрос отвечает последним, уже после возврата на «Расписание».
    const one = { id: 7, employeeId: 4, employeeName: "Даша", date: "2026-10-06", endDate: null, requestedAt: "2026-10-05T09:00:00.000Z", shiftLines: [], handoverForced: false };
    let resolveOld!: (value: typeof one[]) => void;
    vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 0, firstDate: null });
    vi.spyOn(apiClient, "getSickApprovals")
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValue([one, { ...one, id: 8 }]);
    const el = await mount();
    await act(async () => navButton(el, "Работники").click());
    await act(async () => navButton(el, "Расписание").click());
    await waitFor(() => expect(navButton(el, "На подтверждение").querySelector(".sidebar-nav-badge")?.textContent).toBe("2"));
    await act(async () => resolveOld([]));
    await flush();
    expect(navButton(el, "На подтверждение").querySelector(".sidebar-nav-badge")?.textContent).toBe("2");
  });
});
