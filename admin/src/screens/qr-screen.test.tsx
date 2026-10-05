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
  it("четыре образца форм рисуются и отличаются друг от друга", async () => {
    const el = await render();
    const srcs = [...el.querySelectorAll<HTMLImageElement>(".qr-shape .qr-shape-sample")].map((i) => i.src);
    expect(srcs).toHaveLength(4);
    expect(new Set(srcs).size).toBe(4);
    expect(el.querySelector(".qr-shape")!.textContent).toBe("Классика");
  });

  it("эмодзи или иероглиф в подписи — тихая подсказка, обычный текст — без неё", async () => {
    const el = await render();
    const caption = el.querySelector<HTMLInputElement>('input[maxlength="40"]')!;
    await type(el.querySelector("textarea")!, "https://example.com");
    await type(caption, "Сбор на кофе © №1");
    expect(el.textContent).not.toContain("Эмодзи и иероглифы");
    await type(caption, "Сбор 😀");
    expect(el.textContent).toContain("Эмодзи и иероглифы в подпись не попадут — их не нарисует картинка для бота");
    expect(decodeURIComponent(el.querySelector<HTMLImageElement>(".qr-preview img")!.src)).toContain(">Сбор</text>");
    expect(decodeURIComponent(el.querySelector<HTMLImageElement>(".qr-preview img")!.src)).not.toContain("😀");
    await type(caption, "咖啡");
    expect(el.textContent).toContain("Эмодзи и иероглифы");
    await type(caption, "Кофе");
    expect(el.textContent).not.toContain("Эмодзи и иероглифы");
  });

  it("выбранный цвет и форма помечены aria-pressed", async () => {
    const el = await render();
    expect(button(el, "Чёрный").getAttribute("aria-pressed")).toBe("true");
    await act(async () => button(el, "Графит").click());
    expect(button(el, "Графит").getAttribute("aria-pressed")).toBe("true");
    expect(button(el, "Чёрный").getAttribute("aria-pressed")).toBe("false");
  });

  it("сообщение гаснет, когда меняется текст, подпись или стиль", async () => {
    const el = await render();
    const show = async () => {
      await type(el.querySelector("textarea")!, "https://example.com");
      await act(async () => button(el, "Скопировать картинку").click());
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(el.querySelector('[role="status"]')).not.toBeNull();
    };
    await show();
    await type(el.querySelector("textarea")!, "https://example.org");
    expect(el.querySelector('[role="status"]')).toBeNull();
    await show();
    await type(el.querySelector('input[maxlength="40"]')!, "Кофе");
    expect(el.querySelector('[role="status"]')).toBeNull();
    await show();
    await act(async () => button(el, "Точки").click());
    expect(el.querySelector('[role="status"]')).toBeNull();
  });

  it("второй клик, пока копирование идёт, игнорируется", async () => {
    const write = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("ClipboardItem", class { constructor(public items: unknown) {} });
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
    try {
      const el = await render();
      await type(el.querySelector("textarea")!, "https://example.com");
      await act(async () => { button(el, "Скопировать картинку").click(); button(el, "Скопировать картинку").click(); });
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it("синхронный сбой рисования — сообщение на экране, а не необработанный отказ", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const el = await render();
    await type(el.querySelector("textarea")!, "https://example.com");
    // Текст портится после предпросмотра: renderQr при нажатии бросает сразу.
    const ta = el.querySelector("textarea")!;
    vi.stubGlobal("ClipboardItem", class {});
    Object.defineProperty(navigator, "clipboard", { value: { write: vi.fn() }, configurable: true });
    const render2 = await import("@planer/shared/qr");
    const spy = vi.spyOn(render2, "renderQr").mockImplementation(() => { throw new Error("boom"); });
    try {
      await act(async () => button(el, "Скопировать картинку").click());
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(el.querySelector('[role="status"]')!.textContent).toContain("Не получилось");
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      process.off("unhandledRejection", unhandled);
      vi.unstubAllGlobals();
      delete (navigator as { clipboard?: unknown }).clipboard;
      void ta;
    }
  });

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
