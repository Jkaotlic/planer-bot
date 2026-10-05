// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NAV_ITEMS, navLabel } from "../components/Sidebar";
import { QrScreen } from "./QrScreen";

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
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(QrScreen)));
  return host;
}

async function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const button = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label)!;

describe("консоль: экран «QR-код»", () => {
  it("буфер принял картинку — на экране подтверждение, а не отказ", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("ClipboardItem", class { constructor(public items: unknown) {} });
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
    try {
      const el = await render();
      await type(el.querySelector("textarea")!, "https://example.com");
      await act(async () => button(el, "Скопировать картинку").click());
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(write).toHaveBeenCalledTimes(1);
      expect(el.querySelector('[role="status"]')!.textContent).toContain("скопирована");
      expect(el.querySelector('[role="status"].employees-error')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it("заголовок, поле, формы, цвета, подпись; кнопки погашены, пока кода нет", async () => {
    const el = await render();
    expect(el.querySelector("h2")!.textContent).toBe("QR-код");
    expect(el.querySelector('input[maxlength="40"]')).not.toBeNull();
    expect(button(el, "Скачать PNG").disabled).toBe(true);
    expect(button(el, "Скопировать картинку").disabled).toBe(true);
    for (const label of ["Классика", "Точки", "Скруглённый", "Мягкий", "Графит"]) expect(button(el, label), label).toBeDefined();
  });

  it("ввод рисует предпросмотр; форма меняет его", async () => {
    const el = await render();
    await type(el.querySelector("textarea")!, "https://example.com");
    const img = () => el.querySelector<HTMLImageElement>('img[alt="Предпросмотр QR-кода"]')!;
    const before = img().src;
    await act(async () => button(el, "Точки").click());
    expect(img().src).not.toBe(before);
    expect(button(el, "Скачать PNG").disabled).toBe(false);
  });

  it("слишком длинно — объяснение словами под полем", async () => {
    const el = await render();
    await type(el.querySelector("textarea")!, "a".repeat(1001));
    expect(el.querySelector('[role="alert"]')!.textContent).toContain("1000");
  });

  it("буфер недоступен (jsdom, как старый браузер) — сообщение на экране", async () => {
    const el = await render();
    await type(el.querySelector("textarea")!, "https://example.com");
    await act(async () => button(el, "Скопировать картинку").click());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(el.querySelector('[role="status"]')!.textContent).toContain("«Скачать PNG»");
  });
});

it("пункт меню «QR-код» есть и называет экран в мобильной шапке", () => {
  expect(NAV_ITEMS.map((i) => i.label)).toContain("QR-код");
  expect(navLabel("qr")).toBe("QR-код");
});
