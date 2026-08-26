// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Employee } from "../api/client";
import { ShiftKindsScreen } from "./ShiftKindsScreen";

/**
 * Напоминание вида смены: галочка «слать накануне» и свой текст.
 *
 * Проверяется не вёрстка, а три вещи, каждая из которых уже стоила бы письма
 * всей команде: галочка доходит до сервера, предпросмотр показывает письмо с
 * подставленными значениями, а текст с несуществующей подстановкой на сервер
 * не уходит вовсе.
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMPLOYEES: Employee[] = [
  { id: 1, displayName: "Аня Смирнова", isAdmin: false, isActive: true, telegramUserId: 10, birthDate: null, preferredName: null, address: "Аня", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 14) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(ShiftKindsScreen, { employees: EMPLOYEES }));
  });
  await settle();
  return host;
}

/** Раскрывает первую карточку вида смены — настройки живут внутри неё. */
async function openFirstKind(el: HTMLElement) {
  const head = el.querySelector(".kind-card-head") as HTMLButtonElement;
  await act(async () => head.click());
  await settle();
}

function reminderBox(el: HTMLElement): HTMLTextAreaElement {
  const area = el.querySelector("textarea.kind-reminder-text");
  if (!area) throw new Error("поля текста напоминания нет на экране");
  return area as HTMLTextAreaElement;
}

function reminderToggle(el: HTMLElement): HTMLInputElement {
  const box = el.querySelector("input.kind-reminder-toggle");
  if (!box) throw new Error("галочки «Напоминать накануне» нет на экране");
  return box as HTMLInputElement;
}

async function type(area: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(2);
}

describe("напоминание вида смены в консоли", () => {
  it("галочка «Напоминать накануне» доходит до сервера", async () => {
    const save = vi.spyOn(apiClient, "setTemplateReminder").mockResolvedValue(undefined);
    const el = await mount();
    await openFirstKind(el);

    const toggle = reminderToggle(el);
    const before = toggle.checked;
    await act(async () => toggle.click());
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![1]).toBe(!before);
  });

  it("предпросмотр показывает письмо с подставленными значениями", async () => {
    const el = await mount();
    await openFirstKind(el);

    await type(reminderBox(el), "{имя}, завтра {время}");

    expect(el.textContent ?? "").toContain("Аня, завтра 08:00–17:00");
  });

  it("текст с несуществующей подстановкой не уходит на сервер", async () => {
    // Иначе про опечатку узнают, когда письмо уже разошлось по команде.
    const save = vi.spyOn(apiClient, "setTemplateReminder").mockResolvedValue(undefined);
    const el = await mount();
    await openFirstKind(el);

    await type(reminderBox(el), "Завтра {погода}");
    const button = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Сохранить текст"))!;
    await act(async () => button.click());
    await settle();

    expect(save).not.toHaveBeenCalled();
    expect(el.textContent ?? "").toContain("погода");
  });

  it("сохраняет свой текст и говорит, что пустое поле вернёт стандартный", async () => {
    const save = vi.spyOn(apiClient, "setTemplateReminder").mockResolvedValue(undefined);
    const el = await mount();
    await openFirstKind(el);

    await type(reminderBox(el), "{имя}, завтра {время}");
    const button = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Сохранить текст"))!;
    await act(async () => button.click());
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![2]).toBe("{имя}, завтра {время}");
    expect(el.textContent ?? "").toContain("Пустое поле");
  });
});
