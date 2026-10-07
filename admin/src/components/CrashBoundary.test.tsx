// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrashBoundary, isChunkLoadError } from "./CrashBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // React печатает пойманную ошибку сам; падение здесь инсценировано.
  vi.spyOn(console, "error").mockImplementation(() => {});
  window.addEventListener("error", swallow);
});

function swallow(event: ErrorEvent): void {
  event.preventDefault();
}

afterEach(async () => {
  window.removeEventListener("error", swallow);
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

const boom = (message: string) => function Boom(): never { throw new Error(message); };

async function show(message: string) {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
  await act(async () => { root!.render(createElement(CrashBoundary, null, createElement(boom(message)))); });
  return fetchSpy;
}

describe("граница падения консоли", () => {
  it("вместо белой страницы — объяснение по-русски и кнопка обновления", async () => {
    await show("шифт без даты");
    expect(host!.textContent).toContain("Экран сломался");
    expect(host!.textContent).toContain("шифт без даты");
    expect([...host!.querySelectorAll("button")].some((b) => b.textContent === "Обновить страницу")).toBe(true);
  });

  it("кусок, который не загрузился после выкатки, называется прямо: «Обнови страницу»", async () => {
    await show("Failed to fetch dynamically imported module: https://x/assets/QrScreen-abc.js");
    expect(host!.textContent).toContain("Консоль обновилась");
    expect(host!.textContent).toContain("Обнови страницу");
    expect(host!.textContent).not.toContain("Экран сломался");
  });

  it("сообщает на сервер, и по причине видно, что это кусок, а не экран", async () => {
    const spy = await show("Failed to fetch dynamically imported module: x.js");
    const call = spy.mock.calls.find((c) => String(c[0]).includes("/api/client-error"));
    expect(call).toBeTruthy();
    expect(JSON.parse(String((call![1] as RequestInit).body)).reason).toContain("кусок не загрузился");
  });

  it("исправный экран не трогает", async () => {
    await act(async () => { root!.render(createElement(CrashBoundary, null, createElement("p", null, "всё хорошо"))); });
    expect(host!.textContent).toBe("всё хорошо");
  });
});

describe("isChunkLoadError", () => {
  it("узнаёт отказ динамического импорта у Chrome, Safari и Firefox, а чужую ошибку — нет", () => {
    expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module: x"))).toBe(true);
    expect(isChunkLoadError(new Error("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("error loading dynamically imported module: x"))).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
  });
});
