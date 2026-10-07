// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { QrSavedStyle } from "@planer/shared";
import { apiClient } from "../../api/client";
import { QrScreen } from "./QrScreen";

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

async function render(initialStyle: QrSavedStyle = { shape: "classic", color: "black" }) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(AppRoot, null, createElement(QrScreen, { initialStyle, onClose, onSaved }))));
  return { el: host, onClose, onSaved };
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
const preview = (el: HTMLElement) => el.querySelector<HTMLImageElement>('img[alt="Предпросмотр QR-кода"]');

describe("экран «QR-код»", () => {
  it("пока поле пусто — подсказка, после ввода — картинка под полем", async () => {
    const { el } = await render();
    expect(el.querySelector("h1")!.textContent).toBe("QR-код");
    expect(preview(el)).toBeNull();
    expect(el.textContent).toContain("Здесь появится код");
    await type(el.querySelector("textarea")!, "https://example.com");
    expect(preview(el)!.src.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("открывается на сохранённом стиле; форма и цвет меняют предпросмотр", async () => {
    const { el } = await render({ shape: "dots", color: "blue" });
    expect(button(el, "Точки").getAttribute("aria-pressed")).toBe("true");
    expect(button(el, "Синий").getAttribute("aria-pressed")).toBe("true");
    await type(el.querySelector("textarea")!, "https://example.com");
    const before = preview(el)!.src;
    await act(async () => button(el, "Мягкий").click());
    const afterShape = preview(el)!.src;
    await act(async () => button(el, "Бордовый").click());
    expect(new Set([before, afterShape, preview(el)!.src]).size).toBe(3);
    expect(decodeURIComponent(preview(el)!.src)).toContain("#7A1030");
  });

  it("четыре образца форм и шесть цветов", async () => {
    const { el } = await render();
    for (const label of ["Классика", "Точки", "Скруглённый", "Мягкий", "Чёрный", "Синий", "Зелёный", "Фиолетовый", "Бордовый", "Графит"]) {
      expect(button(el, label), label).toBeDefined();
    }
  });

  it("подпись — не длиннее 40 знаков и попадает в картинку экранированной", async () => {
    const { el } = await render();
    const caption = el.querySelector<HTMLInputElement>('input[maxlength]')!;
    expect(caption.maxLength).toBe(40);
    await type(el.querySelector("textarea")!, "https://example.com");
    await type(caption, "<img src=x onerror=alert(1)>");
    expect(decodeURIComponent(preview(el)!.src)).toContain("&lt;img src=x");
    expect(el.querySelector('img[src="x"]')).toBeNull();
  });

  it("эмодзи или иероглиф в подписи — тихая подсказка, обычный текст — без неё", async () => {
    const { el } = await render();
    const caption = el.querySelector<HTMLInputElement>("input[maxlength]")!;
    await type(el.querySelector("textarea")!, "https://example.com");
    await type(caption, "Сбор на кофе © №1");
    expect(el.textContent).not.toContain("Эмодзи и иероглифы");
    await type(caption, "Сбор 😀");
    expect(el.textContent).toContain("Эмодзи и иероглифы в подпись не попадут — их не нарисует картинка для бота");
    // Предпросмотр рисует ровно то, что останется в картинке для бота.
    expect(decodeURIComponent(preview(el)!.src)).toContain(">Сбор</text>");
    expect(decodeURIComponent(preview(el)!.src)).not.toContain("😀");
    await type(caption, "咖啡");
    expect(el.textContent).toContain("Эмодзи и иероглифы");
    await type(caption, "Кофе");
    expect(el.textContent).not.toContain("Эмодзи и иероглифы");
  });

  it("длиннее 1000 знаков — объяснение словами и кнопка погашена", async () => {
    const { el } = await render();
    await type(el.querySelector("textarea")!, "a".repeat(1001));
    expect(el.querySelector('[role="alert"]')!.textContent).toContain("1000");
    expect(button(el, "Прислать мне в бота").disabled).toBe(true);
  });

  it("«Прислать мне в бота» шлёт текст и стиль с подписью и говорит, что ушло", async () => {
    const send = vi.spyOn(apiClient, "sendQrToMe").mockResolvedValue();
    const { el } = await render({ shape: "rounded", color: "green" });
    await type(el.querySelector("textarea")!, "https://example.com");
    await type(el.querySelector<HTMLInputElement>("input[maxlength]")!, " Сбор на кофе ");
    await act(async () => button(el, "Прислать мне в бота").click());
    expect(send).toHaveBeenCalledWith("https://example.com", { shape: "rounded", color: "green", caption: "Сбор на кофе" });
    expect(el.querySelector('[role="status"]')!.textContent).toContain("Отправил");
  });

  it("отказ сервера показан его словами", async () => {
    vi.spyOn(apiClient, "sendQrToMe").mockRejectedValue(new Error("Не чаще раза в 5 секунд — подожди немного"));
    const { el } = await render();
    await type(el.querySelector("textarea")!, "https://example.com");
    await act(async () => button(el, "Прислать мне в бота").click());
    expect(el.textContent).toContain("Не чаще раза в 5 секунд");
  });

  it("уход с изменённым стилем сохраняет форму и цвет; без изменений — запроса нет", async () => {
    const save = vi.spyOn(apiClient, "setQrStyle").mockResolvedValue({ shape: "soft", color: "black" });
    const first = await render();
    await act(async () => button(first.el, "Мягкий").click());
    await act(async () => button(first.el, "Назад").click());
    expect(save).toHaveBeenCalledWith({ shape: "soft", color: "black" });
    // Уход не ждёт сеть: пока ответа нет, наружу отдан тот стиль, что точно на сервере.
    expect(first.onClose).toHaveBeenCalledWith({ shape: "classic", color: "black" });
    expect(first.onSaved).toHaveBeenCalledWith({ shape: "soft", color: "black" });

    await act(async () => root!.unmount());
    host!.remove();
    save.mockClear();
    const second = await render();
    await act(async () => button(second.el, "Назад").click());
    expect(save).not.toHaveBeenCalled();
  });

  it("после отправки уход не сохраняет второй раз — сервер уже запомнил", async () => {
    vi.spyOn(apiClient, "sendQrToMe").mockResolvedValue();
    const save = vi.spyOn(apiClient, "setQrStyle").mockResolvedValue({ shape: "dots", color: "black" });
    const { el } = await render();
    await act(async () => button(el, "Точки").click());
    await type(el.querySelector("textarea")!, "https://example.com");
    await act(async () => button(el, "Прислать мне в бота").click());
    await act(async () => button(el, "Назад").click());
    expect(save).not.toHaveBeenCalled();
  });

  // Образцы форм — не декор: если все четыре одинаковы, человек выбирает вслепую.
  it("четыре образца форм рисуются по-разному", async () => {
    const { el } = await render();
    const sources = ["Классика", "Точки", "Скруглённый", "Мягкий"].map((l) => button(el, l).querySelector("img")!.src);
    expect(new Set(sources).size).toBe(4);
  });

  it("двойное касание «Прислать мне в бота» шлёт один раз", async () => {
    const send = vi.spyOn(apiClient, "sendQrToMe").mockReturnValue(new Promise(() => {}));
    const { el } = await render();
    await type(el.querySelector("textarea")!, "https://example.com");
    const go = button(el, "Прислать мне в бота");
    await act(async () => {
      go.click();
      go.click();
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("итог отправки гаснет, когда меняется текст, подпись, форма или цвет", async () => {
    const send = vi.spyOn(apiClient, "sendQrToMe").mockResolvedValue();
    const { el } = await render();
    const text = () => el.querySelector("textarea")!;
    await type(text(), "https://example.com");
    const edits: Array<() => Promise<void>> = [
      () => type(text(), "https://example.org"),
      () => type(el.querySelector<HTMLInputElement>("input[maxlength]")!, "Сбор"),
      () => act(async () => button(el, "Точки").click()),
      () => act(async () => button(el, "Синий").click()),
    ];
    for (const change of edits) {
      await act(async () => button(el, "Прислать мне в бота").click());
      expect(el.querySelector('[role="status"]')).not.toBeNull();
      await change();
      expect(el.querySelector('[role="status"]')).toBeNull();
    }
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("отправка не удалась, а потом «Назад» — стиль всё равно сохраняется", async () => {
    vi.spyOn(apiClient, "sendQrToMe").mockRejectedValue(new Error("Не чаще раза в 5 секунд"));
    const save = vi.spyOn(apiClient, "setQrStyle").mockResolvedValue({ shape: "dots", color: "black" });
    const { el } = await render();
    await act(async () => button(el, "Точки").click());
    await type(el.querySelector("textarea")!, "https://example.com");
    await act(async () => button(el, "Прислать мне в бота").click());
    await act(async () => button(el, "Назад").click());
    expect(save).toHaveBeenCalledWith({ shape: "dots", color: "black" });
  });

  it("отказ сохранения стиля при уходе: наружу не уходит несохранённый выбор", async () => {
    vi.spyOn(apiClient, "setQrStyle").mockRejectedValue(new Error("сеть"));
    const { el, onClose, onSaved } = await render();
    await act(async () => button(el, "Мягкий").click());
    await act(async () => button(el, "Назад").click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(onClose).toHaveBeenCalledWith({ shape: "classic", color: "black" });
    expect(onSaved).not.toHaveBeenCalled();
  });
});
