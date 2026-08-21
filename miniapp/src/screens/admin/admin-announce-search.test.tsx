// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type AnnouncementRecipient } from "../../api/client";
import { AdminAnnounce } from "./AdminAnnounce";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEAM: AnnouncementRecipient[] = [
  { id: 1, displayName: "Иванова Анна", reachable: true },
  { id: 2, displayName: "Петров Игорь", reachable: true },
  { id: 3, displayName: "Семёнов Марк", reachable: true },
  { id: 4, displayName: "Соколова Вера", reachable: true },
  { id: 5, displayName: "Кузнецов Пётр", reachable: true },
  { id: 6, displayName: "Орлова Ника", reachable: true },
];

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

async function mount(team: AnnouncementRecipient[]) {
  vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue(team);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(AdminAnnounce))); });
  await settle();
  return host;
}

/**
 * Все три подписи, за которыми охотится этот хелпер («Выбрать», «Отправить»,
 * «Да, отправить»), — настоящие `<button>` (telegram-ui рендерит и
 * `SegmentedControl.Item`, и `Button` кнопкой). Искать ещё и по `div, span`
 * казалось безопасным про запас, но подвело: `CardShell`, обёртка одной-
 * единственной кнопки, сама не несёт своего текста, поэтому её trimmed
 * `textContent` совпадает с текстом кнопки внутри — и `find` в порядке
 * документа (предок раньше потомка) возвращал div-обёртку раньше самой
 * кнопки. Клик по такому div — no-op, обработчик висит на `<button>`.
 */
function byText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll<HTMLButtonElement>("button")].find(
    (n) => (n.textContent ?? "").trim() === text,
  );
  if (!found) throw new Error(`не нашёл «${text}»`);
  return found;
}

function rows(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(".announce-picker-row")];
}

function rowByName(el: HTMLElement, name: string): HTMLElement {
  const found = rows(el).find((r) => (r.textContent ?? "").includes(name));
  if (!found) throw new Error(`не нашёл строку «${name}»`);
  return found;
}

function searchField(el: HTMLElement): HTMLInputElement {
  const found = el.querySelector<HTMLInputElement>('input[aria-label="Поиск по имени"]');
  if (!found) throw new Error("не нашёл поле поиска");
  return found;
}

async function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function openPicker(el: HTMLElement) {
  await act(async () => { byText(el, "Выбрать").click(); });
  await settle();
}

describe("поиск получателя в мини-апповском анонсе", () => {
  it("прячет несовпавшие строки и оставляет совпавшие", async () => {
    const el = await mount(TEAM);
    await openPicker(el);

    await typeInto(searchField(el), "ив");
    const names = rows(el).map((r) => (r.textContent ?? "").trim()).join(" ");
    expect(names).toContain("Иванова Анна");
    expect(names).not.toContain("Петров Игорь");
  });

  it("ПОИСК НЕ СНИМАЕТ ГАЛОЧКИ: отметил при одном запросе, отметил при другом — уйдёт обоим", async () => {
    const send = vi.spyOn(apiClient, "sendAnnouncement").mockResolvedValue({ delivered: 2, intended: 2, unreachable: [] });
    const el = await mount(TEAM);
    await openPicker(el);

    // Текст печатаем первым: и клик по галке, и ввод в поиск сбрасывают
    // `confirming`, а печать текста ниже по сценарию сбросила бы его тоже —
    // взводить кнопку «Отправить» нужно самым последним действием.
    await typeInto(el.querySelector("textarea")!, "Завтра сбор в 10");

    const field = searchField(el);
    await typeInto(field, "иванова");
    await act(async () => { rowByName(el, "Иванова Анна").querySelector("input")!.click(); });
    await typeInto(field, "семёнов");
    await act(async () => { rowByName(el, "Семёнов Марк").querySelector("input")!.click(); });
    // Запрос НЕ очищаем: «семёнов» на момент отправки прячет строку «Иванова
    // Анна» — она выбрана, но физически скрыта поиском. Если бы отправка
    // считала получателей из отфильтрованного списка, а не из `selectedIds`,
    // именно это состояние поймало бы баг; тест, который перед отправкой
    // стирает запрос, эту разницу не увидел бы никогда.
    expect(rows(el).map((r) => (r.textContent ?? "").trim()).join(" ")).not.toContain("Иванова Анна");

    await act(async () => { byText(el, "Отправить").click(); });
    await act(async () => { byText(el, "Да, отправить").click(); });
    await settle();

    expect(send).toHaveBeenCalledWith("Завтра сбор в 10", [1, 3]);
  });

  it("блок «Уйдёт» поиску не подчиняется — выбранный виден, даже когда скрыт", async () => {
    const el = await mount(TEAM);
    await openPicker(el);

    const field = searchField(el);
    await typeInto(field, "иванова");
    await act(async () => { rowByName(el, "Иванова Анна").querySelector("input")!.click(); });
    await typeInto(field, "орлова");

    const preview = el.querySelector(".announce-recipients-preview")!;
    expect(preview.textContent).toContain("Иванова Анна");
  });

  it("на коротком списке поля поиска нет", async () => {
    const el = await mount(TEAM.slice(0, 3));
    await openPicker(el);

    expect(el.querySelector('input[aria-label="Поиск по имени"]')).toBeNull();
  });
});
