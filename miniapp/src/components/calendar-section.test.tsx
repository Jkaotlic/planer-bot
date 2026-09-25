// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { CalendarSection } from "./CalendarSection";
import { apiClient } from "../api/client";

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

async function settle(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(CalendarSection)));
  });
  await settle();
  return host;
}

function buttonWithText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`кнопка «${text}» не найдена среди: ${[...el.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  return found;
}

describe("раздел «Календарь»", () => {
  it("без подписки — кнопка «Подключить»", async () => {
    vi.spyOn(apiClient, "getCalendarLink").mockResolvedValue(null);
    const el = await mount();
    expect(el.textContent).toContain("Подключить");
    expect(el.textContent).not.toContain("Отключить");
  });

  /**
   * Отказ первого запроса — это «не знаем, подключено ли», а не «точно
   * выключено». Показать здесь «Подключить» значило бы дать кнопку, которая
   * при реально существующей подписке молча пересоздаёт токен (POST заводит
   * новый всегда) — человек не просил менять ссылку, просто не дождался
   * ответа на чтение.
   */
  it("отказ первого запроса — ошибка и «Повторить», а не «Подключить»", async () => {
    const get = vi.spyOn(apiClient, "getCalendarLink").mockRejectedValue(new Error("Сеть недоступна"));
    const el = await mount();

    expect(el.textContent).toContain("Сеть недоступна");
    expect(el.textContent).toContain("Повторить");
    expect(el.textContent).not.toContain("Подключить");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("«Повторить» зовёт getCalendarLink заново и показывает результат", async () => {
    const get = vi
      .spyOn(apiClient, "getCalendarLink")
      .mockRejectedValueOnce(new Error("Сеть недоступна"))
      .mockResolvedValueOnce("https://x.example.com/cal/abc123.ics");
    const el = await mount();
    expect(el.textContent).toContain("Повторить");

    await act(async () => buttonWithText(el, "Повторить").click());
    await settle();

    expect(get).toHaveBeenCalledTimes(2);
    expect(el.textContent).toContain("Добавить в календарь");
    expect(el.textContent).not.toContain("Повторить");
  });

  it("тап «Подключить» зовёт createCalendarLink и показывает управление ссылкой", async () => {
    vi.spyOn(apiClient, "getCalendarLink").mockResolvedValue(null);
    const create = vi.spyOn(apiClient, "createCalendarLink").mockResolvedValue("https://x.example.com/cal/abc123.ics");
    const el = await mount();

    await act(async () => buttonWithText(el, "Подключить").click());
    await settle();

    expect(create).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain("Добавить в календарь");
    expect(el.textContent).toContain("Скопировать ссылку");
    expect(el.textContent).toContain("Сменить ссылку");
    expect(el.textContent).toContain("Отключить");
  });

  // webcal из WebView Telegram не проверен «в бою» (ledger-раунд ревью
  // 2026-09-25): подсказка не может утверждать, что тап всегда сработает, и
  // должна оставлять ручной путь для тех, у кого не открылось.
  it("подсказка для iPhone называет ручной путь на случай, если webcal не открылся", async () => {
    vi.spyOn(apiClient, "getCalendarLink").mockResolvedValue("https://x.example.com/cal/abc123.ics");
    const el = await mount();

    expect(el.textContent).toContain("Если не открылось");
    expect(el.textContent).toContain("Настройки → Календарь → Учётные записи → Новая учётная запись → Другое → Подписной календарь");
  });

  it("уже подключено — «Добавить в календарь» ведёт на webcal://", async () => {
    vi.spyOn(apiClient, "getCalendarLink").mockResolvedValue("https://x.example.com/cal/abc123.ics");
    const el = await mount();

    const link = el.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("webcal://x.example.com/cal/abc123.ics");
  });

  it("«Сменить ссылку» спрашивает подтверждение и зовёт createCalendarLink только после «Да»", async () => {
    vi.spyOn(apiClient, "getCalendarLink").mockResolvedValue("https://x.example.com/cal/old.ics");
    const create = vi.spyOn(apiClient, "createCalendarLink").mockResolvedValue("https://x.example.com/cal/new.ics");
    const el = await mount();

    await act(async () => buttonWithText(el, "Сменить ссылку").click());
    await settle();
    expect(create).not.toHaveBeenCalled();
    expect(el.textContent).toContain("перестанет работать");

    await act(async () => buttonWithText(el, "Да, сменить").click());
    await settle();

    expect(create).toHaveBeenCalledTimes(1);
    const link = el.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("webcal://x.example.com/cal/new.ics");
  });

  it("«Отмена» у подтверждения не зовёт createCalendarLink", async () => {
    vi.spyOn(apiClient, "getCalendarLink").mockResolvedValue("https://x.example.com/cal/old.ics");
    const create = vi.spyOn(apiClient, "createCalendarLink");
    const el = await mount();

    await act(async () => buttonWithText(el, "Сменить ссылку").click());
    await settle();
    await act(async () => buttonWithText(el, "Отмена").click());
    await settle();

    expect(create).not.toHaveBeenCalled();
    expect(el.textContent).toContain("Сменить ссылку");
  });

  it("«Отключить» зовёт deleteCalendarLink и возвращает «Подключить»", async () => {
    vi.spyOn(apiClient, "getCalendarLink").mockResolvedValue("https://x.example.com/cal/abc123.ics");
    const del = vi.spyOn(apiClient, "deleteCalendarLink").mockResolvedValue(undefined);
    const el = await mount();

    await act(async () => buttonWithText(el, "Отключить").click());
    await settle();

    expect(del).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain("Подключить");
    expect(el.textContent).not.toContain("Добавить в календарь");
  });

  it("ошибка создания ссылки рисуется рядом с кнопкой, а не молча теряется", async () => {
    vi.spyOn(apiClient, "getCalendarLink").mockResolvedValue(null);
    vi.spyOn(apiClient, "createCalendarLink").mockRejectedValue(new Error("Сеть недоступна"));
    const el = await mount();

    await act(async () => buttonWithText(el, "Подключить").click());
    await settle();

    expect(el.textContent).toContain("Сеть недоступна");
    // Кнопка на месте — отказ не должен превращать раздел в тупик.
    expect(el.textContent).toContain("Подключить");
  });

  it("ошибка отключения рисуется рядом с кнопкой, ссылка остаётся рабочей", async () => {
    vi.spyOn(apiClient, "getCalendarLink").mockResolvedValue("https://x.example.com/cal/abc123.ics");
    vi.spyOn(apiClient, "deleteCalendarLink").mockRejectedValue(new Error("Сеть недоступна"));
    const el = await mount();

    await act(async () => buttonWithText(el, "Отключить").click());
    await settle();

    expect(el.textContent).toContain("Сеть недоступна");
    expect(el.textContent).toContain("Добавить в календарь");
  });

  it("«Скопировать ссылку» пишет в navigator.clipboard, когда он доступен", async () => {
    vi.spyOn(apiClient, "getCalendarLink").mockResolvedValue("https://x.example.com/cal/abc123.ics");
    const writeText = vi.fn().mockResolvedValue(undefined);
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      const el = await mount();
      await act(async () => buttonWithText(el, "Скопировать ссылку").click());
      await settle();

      expect(writeText).toHaveBeenCalledWith("https://x.example.com/cal/abc123.ics");
      // Никакого поля со ссылкой текстом — клипборд сработал сам.
      expect(el.querySelector("input")).toBeNull();
    } finally {
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it("«Скопировать ссылку» без navigator.clipboard показывает ссылку текстом, а не молчит", async () => {
    vi.spyOn(apiClient, "getCalendarLink").mockResolvedValue("https://x.example.com/cal/abc123.ics");
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    try {
      const el = await mount();
      await act(async () => buttonWithText(el, "Скопировать ссылку").click());
      await settle();

      const input = el.querySelector<HTMLInputElement>("input");
      expect(input).not.toBeNull();
      expect(input!.value).toBe("https://x.example.com/cal/abc123.ics");
    } finally {
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  /**
   * Таймер «Скопировано ✓» (1500мс) не должен звать `setState` после того, как
   * компонент уже размонтирован — раздел закрывают свайпом на другую вкладку
   * быстрее, чем таймер успевает сработать.
   */
  it("таймер сброса «Скопировано ✓» гасится при размонтировании", async () => {
    vi.spyOn(apiClient, "getCalendarLink").mockResolvedValue("https://x.example.com/cal/abc123.ics");
    const writeText = vi.fn().mockResolvedValue(undefined);
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    try {
      const el = await mount();
      await act(async () => buttonWithText(el, "Скопировать ссылку").click());
      await settle();
      expect(el.textContent).toContain("Скопировано");

      const callsBeforeUnmount = clearTimeoutSpy.mock.calls.length;
      await act(async () => root!.unmount());
      host?.remove();
      root = null;
      host = null;

      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(callsBeforeUnmount);
    } finally {
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });
});
