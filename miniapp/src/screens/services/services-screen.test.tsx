// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ServicesScreen } from "./ServicesScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function render() {
  const props = { onOpenFood: vi.fn(), onOpenQr: vi.fn(), onClose: vi.fn() };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(AppRoot, null, createElement(ServicesScreen, props))));
  return { el: host, ...props };
}

const row = (el: HTMLElement, title: string) =>
  [...el.querySelectorAll<HTMLButtonElement>(".ui-menu-row")].find((b) => b.textContent!.includes(title))!;

describe("экран «Сервисы»", () => {
  it("заголовок и два пункта в порядке спеки", async () => {
    const { el } = await render();
    expect(el.querySelector("h1")!.textContent).toBe("Сервисы");
    expect([...el.querySelectorAll(".ui-menu-row__title")].map((t) => t.textContent)).toEqual(["Заказы и опросы", "QR-код"]);
  });

  it("пункты ведут каждый в своё, «Назад» закрывает", async () => {
    const { el, onOpenFood, onOpenQr, onClose } = await render();
    await act(async () => row(el, "Заказы и опросы").click());
    await act(async () => row(el, "QR-код").click());
    await act(async () => (el.querySelector('button[aria-label="Назад"]') as HTMLButtonElement).click());
    expect([onOpenFood.mock.calls.length, onOpenQr.mock.calls.length, onClose.mock.calls.length]).toEqual([1, 1, 1]);
  });
});
