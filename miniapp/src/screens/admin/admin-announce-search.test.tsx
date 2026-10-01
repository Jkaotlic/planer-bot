// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type AnnouncementRecipient, type RecipientGroupView } from "../../api/client";
import { AdminAnnounce } from "./AdminAnnounce";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEAM: AnnouncementRecipient[] = [
  { id: 1, displayName: "Иванова Анна", reachable: true, role: "worker" },
  { id: 2, displayName: "Петров Игорь", reachable: true, role: "worker" },
  { id: 3, displayName: "Семёнов Марк", reachable: true, role: "worker" },
  { id: 4, displayName: "Соколова Вера", reachable: true, role: "worker" },
  { id: 5, displayName: "Кузнецов Пётр", reachable: true, role: "worker" },
  { id: 6, displayName: "Орлова Ника", reachable: true, role: "worker" },
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

async function mount(team: AnnouncementRecipient[], groups: RecipientGroupView[] = []) {
  vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue(groups);
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
 * казалось безопасным про запас, но подвело: карточка-обёртка одной-
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
    const send = vi.spyOn(apiClient, "sendAnnouncement").mockResolvedValue({ delivered: 2, intended: 2, unreachable: [], archivedCount: 0 });
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

  // Баг из ledger: архивный в отчёте не называется по имени — только числом.
  it("отчёт про архивных — числом, без единого имени бывшего сотрудника", async () => {
    vi.spyOn(apiClient, "sendAnnouncement").mockResolvedValue({
      delivered: 1,
      intended: 3,
      unreachable: [],
      archivedCount: 2,
    });
    const el = await mount(TEAM.slice(0, 1));

    await typeInto(el.querySelector("textarea")!, "Завтра сбор в 10");
    await act(async () => { byText(el, "Отправить").click(); });
    await act(async () => { byText(el, "Да, отправить").click(); });
    await settle();

    expect(el.textContent).toContain("Не дошло: 2 — в архиве");
  });
});

describe("кнопки «Админам» / «Работникам» в мини-апповском анонсе", () => {
  it.each([
    ["Админам", [1]],
    ["Работникам", [2]],
  ])("«%s» отмечает свою роль, наблюдатель не попадает никуда", async (button, ids) => {
    const send = vi.spyOn(apiClient, "sendAnnouncement").mockResolvedValue({ delivered: 1, intended: 1, unreachable: [], archivedCount: 0 });
    const el = await mount([
      { id: 1, displayName: "Иванова Анна", reachable: true, role: "admin" },
      { id: 2, displayName: "Петров Игорь", reachable: true, role: "worker" },
      { id: 3, displayName: "Орлова Ника", reachable: true, role: "observer" },
    ]);
    await typeInto(el.querySelector("textarea")!, "Новое в журнале");
    await act(async () => { byText(el, button).click(); });
    expect(rowByName(el, "Орлова Ника").querySelector("input")!.checked).toBe(false);
    await act(async () => { byText(el, "Отправить").click(); });
    await act(async () => { byText(el, "Да, отправить").click(); });
    await settle();
    expect(send).toHaveBeenCalledWith("Новое в журнале", ids);
  });
});

describe("кнопки групп в мини-апповском анонсе", () => {
  const GROUPS: RecipientGroupView[] = [{ id: 7, name: "ЧИП 5-й этаж", memberIds: [2, 3, 99] }];

  it("группа отмечает свой состав (чужой id отбрасывается) и уходит списком", async () => {
    const send = vi.spyOn(apiClient, "sendAnnouncement").mockResolvedValue({ delivered: 2, intended: 2, unreachable: [], archivedCount: 0 });
    const el = await mount(TEAM, GROUPS);
    await typeInto(el.querySelector("textarea")!, "Завтра сбор");
    await act(async () => { byText(el, "ЧИП 5-й этаж").click(); });
    await act(async () => { byText(el, "Отправить").click(); });
    await act(async () => { byText(el, "Да, отправить").click(); });
    await settle();
    expect(send).toHaveBeenCalledWith("Завтра сбор", [2, 3]);
  });

  it("ручная галочка после группы снимает подсветку", async () => {
    const el = await mount(TEAM, GROUPS);
    // Подсветку несёт `aria-pressed`: все кнопки ряда — одного вида, и по классу
    // выбранную от невыбранной не отличить.
    expect(el.querySelector("[data-testid=group-row]")).not.toBeNull();
    expect(byText(el, "ЧИП 5-й этаж").getAttribute("aria-pressed")).toBe("false");
    await act(async () => { byText(el, "ЧИП 5-й этаж").click(); });
    expect(byText(el, "ЧИП 5-й этаж").getAttribute("aria-pressed")).toBe("true");
    await act(async () => { rowByName(el, "Иванова Анна").querySelector("input")!.click(); });
    expect(byText(el, "ЧИП 5-й этаж").getAttribute("aria-pressed")).toBe("false");
  });

  it("без групп ряда нет", async () => {
    const el = await mount(TEAM, []);
    expect(el.querySelector("[data-testid=group-row]")).toBeNull();
  });
});

describe("подборки адресатов в анонсе", () => {
  it("«Админам»/«Работникам» и группы — обычные кнопки: тихие читались бы как ссылки", async () => {
    const el = await mount(TEAM, [{ id: 7, name: "Дежурные", memberIds: [1] } as unknown as RecipientGroupView]);
    for (const label of ["Админам", "Работникам", "Дежурные"]) {
      expect(byText(el, label).className).not.toContain("ui-btn--quiet");
    }
  });

  it("выбранная подборка отмечена aria-pressed", async () => {
    const el = await mount(TEAM);
    await act(async () => { byText(el, "Админам").click(); });
    await settle();
    expect(byText(el, "Админам").getAttribute("aria-pressed")).toBe("true");
    expect(byText(el, "Работникам").getAttribute("aria-pressed")).toBe("false");
  });
});
