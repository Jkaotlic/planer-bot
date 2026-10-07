// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// Кусок с экраном QR не загрузился — как после выкатки, когда файла со старым хешем уже нет.
// Модуль, при чтении экрана из которого `import()` отклоняется той же ошибкой, что даёт браузер.
vi.mock("./screens/QrScreen", () => ({
  get QrScreen(): never {
    throw new Error("Failed to fetch dynamically imported module: https://x/assets/QrScreen-old.js");
  },
}));

import { App } from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
}

describe("экран QR консоли — отдельный кусок", () => {
  it("если кусок не загрузился, вместо белого экрана — «Обнови страницу», а остальная консоль жива", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const swallow = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener("error", swallow);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(App)); });
    await settle();

    const qr = [...host.querySelectorAll(".sidebar-nav-item")].find((n) => (n.textContent ?? "").includes("QR-код"));
    await act(async () => (qr as HTMLElement).click());
    await settle();
    window.removeEventListener("error", swallow);

    expect(host.textContent).toContain("Консоль обновилась");
    expect(host.textContent).toContain("Обнови страницу");
    // Сайдбар на месте: упал один экран, а не вся консоль, и выход (другой раздел) есть.
    expect(host.querySelector(".sidebar")).not.toBeNull();
    const other = [...host.querySelectorAll(".sidebar-nav-item")].find((n) => (n.textContent ?? "").includes("Баги"));
    await act(async () => (other as HTMLElement).click());
    await settle();
    expect(host.textContent).not.toContain("Консоль обновилась");
  });
});
