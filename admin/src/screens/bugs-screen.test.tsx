// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type BugReportRow } from "../api/client";
import { BugsScreen } from "./BugsScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function report(patch: Partial<BugReportRow> = {}): BugReportRow {
  return {
    id: 1, authorName: "Аня", text: "Кнопка «Больничный» не открывается",
    createdAt: "2026-08-20T09:00:00.000Z", resolvedAt: null, resolvedByName: null, ...patch,
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null; host = null;
  vi.restoreAllMocks();
});

async function settle(times = 10) {
  for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(BugsScreen)); });
  await settle();
  return host;
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);
  if (!found) throw new Error(`не нашёл кнопку «${text}»`);
  return found;
}

describe("«Баги» в консоли", () => {
  it("рисует автора и текст жалобы", async () => {
    vi.spyOn(apiClient, "getBugReports").mockResolvedValue([report()]);
    const el = await mount();
    expect(el.textContent).toContain("Аня");
    expect(el.textContent).toContain("Кнопка «Больничный» не открывается");
  });

  it("«Разобрал» шлёт resolved: true и перечитывает список с сервера", async () => {
    const get = vi.spyOn(apiClient, "getBugReports").mockResolvedValue([report()]);
    const resolve = vi.spyOn(apiClient, "resolveBugReport").mockResolvedValue({ id: 1, resolvedAt: "2026-08-21T10:00:00.000Z" });
    const el = await mount();
    const callsBefore = get.mock.calls.length;

    await act(async () => { buttonByText(el, "Разобрал").click(); });
    await settle();

    expect(resolve).toHaveBeenCalledWith(1, true);
    expect(get.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("у разобранной кнопка возвращает в работу — отметка обратима", async () => {
    vi.spyOn(apiClient, "getBugReports").mockResolvedValue([
      report({ resolvedAt: "2026-08-20T12:00:00.000Z", resolvedByName: "Игорь" }),
    ]);
    const resolve = vi.spyOn(apiClient, "resolveBugReport").mockResolvedValue({ id: 1, resolvedAt: null });
    const el = await mount();

    await act(async () => { buttonByText(el, "Вернуть в работу").click(); });
    await settle();

    expect(resolve).toHaveBeenCalledWith(1, false);
  });

  it("«Все» перечитывает список другим статусом, а не фильтрует загруженное", async () => {
    const get = vi.spyOn(apiClient, "getBugReports").mockResolvedValue([report()]);
    const el = await mount();

    await act(async () => { buttonByText(el, "Все").click(); });
    await settle();

    expect(get).toHaveBeenCalledWith("all");
  });

  it("ошибка загрузки названа и даёт «Повторить»", async () => {
    const get = vi.spyOn(apiClient, "getBugReports").mockRejectedValue(new Error("Сервер недоступен"));
    const el = await mount();
    expect(el.textContent).toContain("Сервер недоступен");

    const callsBefore = get.mock.calls.length;
    await act(async () => { buttonByText(el, "Повторить").click(); });
    await settle();
    expect(get.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
