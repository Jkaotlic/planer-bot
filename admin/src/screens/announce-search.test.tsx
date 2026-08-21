// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type AnnouncementRecipient } from "../api/client";
import { AnnounceScreen } from "./AnnounceScreen";

/**
 * Поиск получателя в «Анонсах»: единственная рассылка в системе, которая
 * проходит сквозь все личные настройки тишины и не отзывается после отправки.
 * Поэтому здесь проверяется не только «поиск находит», но и то, ради чего эта
 * задача вообще существует — поиск прячет строки, но не снимает галочки.
 */

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

async function settle(times = 10) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AnnounceScreen));
  });
  await settle();
  return host;
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);
  if (!found) throw new Error(`не нашёл кнопку с подписью «${text}»`);
  return found;
}

function textareaByLabel(el: HTMLElement, label: string): HTMLTextAreaElement {
  const found = el.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);
  if (!found) throw new Error(`не нашёл поле «${label}»`);
  return found;
}

async function type(field: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Строка выбора получателя в режиме «Выбрать» — по её видимому имени. */
function pickerRow(el: HTMLElement, name: string): HTMLElement {
  const found = [...el.querySelectorAll<HTMLElement>(".announce-picker-row")].find((row) =>
    (row.textContent ?? "").includes(name),
  );
  if (!found) throw new Error(`не нашёл строку выбора «${name}»`);
  return found;
}

function searchField(el: HTMLElement): HTMLInputElement {
  const found = el.querySelector<HTMLInputElement>('input[aria-label="Поиск по имени"]');
  if (!found) throw new Error("не нашёл поле поиска");
  return found;
}

async function typeSearch(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function visibleNames(el: HTMLElement): string[] {
  return [...el.querySelectorAll<HTMLElement>(".announce-picker-row")].map((r) => (r.textContent ?? "").trim());
}

const TEAM: AnnouncementRecipient[] = [
  { id: 1, displayName: "Иванова Анна", reachable: true },
  { id: 2, displayName: "Петров Игорь", reachable: true },
  { id: 3, displayName: "Семёнов Марк", reachable: true },
  { id: 4, displayName: "Соколова Вера", reachable: true },
  { id: 5, displayName: "Кузнецов Пётр", reachable: true },
  { id: 6, displayName: "Орлова Ника", reachable: true },
];

describe("поиск получателя в «Анонсах»", () => {
  it("прячет несовпавшие строки и оставляет совпавшие", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue(TEAM);
    const el = await mount();
    await act(async () => {
      buttonByText(el, "Выбрать").click();
    });
    await settle();

    await typeSearch(searchField(el), "ив");
    expect(visibleNames(el).join(" ")).toContain("Иванова Анна");
    expect(visibleNames(el).join(" ")).not.toContain("Петров Игорь");
  });

  it("ПОИСК НЕ СНИМАЕТ ГАЛОЧКИ: отметил при одном запросе, отметил при другом — уйдёт обоим", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue(TEAM);
    const send = vi.spyOn(apiClient, "sendAnnouncement").mockResolvedValue({ delivered: 2, intended: 2, unreachable: [] });
    const el = await mount();
    await act(async () => {
      buttonByText(el, "Выбрать").click();
    });
    await settle();

    // Текст печатаем первым: и toggle чекбокса, и typeSearch сбрасывают
    // `confirming`, а печать текста ниже по сценарию его тоже сбросила бы —
    // взводить кнопку «Отправить» нужно самым последним действием.
    await type(textareaByLabel(el, "Текст анонса"), "Завтра сбор в 10");

    const field = searchField(el);
    await typeSearch(field, "иванова");
    await act(async () => {
      pickerRow(el, "Иванова Анна").querySelector("input")!.click();
    });
    await typeSearch(field, "семёнов");
    await act(async () => {
      pickerRow(el, "Семёнов Марк").querySelector("input")!.click();
    });
    // Запрос НЕ очищаем: «семёнов» на момент отправки прячет строку «Иванова
    // Анна» — она выбрана, но физически скрыта поиском. Если бы отправка
    // считала получателей из отфильтрованного списка, а не из `selectedIds`,
    // именно это состояние поймало бы баг; тест, который перед отправкой
    // стирает запрос, эту разницу не увидел бы никогда.
    expect(visibleNames(el).join(" ")).not.toContain("Иванова Анна");

    await act(async () => {
      buttonByText(el, "Отправить").click();
    });
    await act(async () => {
      buttonByText(el, "Да, отправить").click();
    });
    await settle();

    expect(send).toHaveBeenCalledWith("Завтра сбор в 10", [1, 3]);
  });

  it("блок «Уйдёт» поиску не подчиняется — выбранный виден, даже когда скрыт", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue(TEAM);
    const el = await mount();
    await act(async () => {
      buttonByText(el, "Выбрать").click();
    });
    await settle();

    await typeSearch(searchField(el), "иванова");
    await act(async () => {
      pickerRow(el, "Иванова Анна").querySelector("input")!.click();
    });
    await typeSearch(searchField(el), "орлова");

    const recipients = el.querySelector(".birthday-recipients")!;
    expect(recipients.textContent).toContain("Иванова Анна");
  });

  it("на коротком списке поля поиска нет", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue(TEAM.slice(0, 3));
    const el = await mount();
    await act(async () => {
      buttonByText(el, "Выбрать").click();
    });
    await settle();

    expect(el.querySelector('input[aria-label="Поиск по имени"]')).toBeNull();
  });
});
