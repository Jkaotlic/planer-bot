// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANNOUNCEMENT_TEXT_MAX, apiClient, type AnnouncementRecipient, type RecipientGroupView } from "../api/client";
import { AnnounceScreen } from "./AnnounceScreen";

/**
 * Экран «Анонсы» в консоли: рассылки в вебке до этой работы не было вовсе.
 *
 * Поведение перенесено из мини-апповского `AdminAnnounce`, и проверяется здесь
 * ровно то, что там уже один раз стоило занудства: второй клик, а не первый,
 * шлёт сообщение, которое не отзывается; недостижимый виден, но не считается
 * «кому уйдёт»; отчёт после отправки называет недошедших поимённо.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function recipient(patch: Partial<AnnouncementRecipient> = {}): AnnouncementRecipient {
  return { id: 1, displayName: "Аня", reachable: true, role: "worker", ...patch };
}

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

function checkboxIn(row: HTMLElement): HTMLInputElement {
  const found = row.querySelector<HTMLInputElement>("input[type=checkbox]");
  if (!found) throw new Error("в строке нет чекбокса");
  return found;
}

describe("AnnounceScreen", () => {
  it("первый клик по «Отправить» не шлёт, второй — шлёт", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue([recipient()]);
    const send = vi.spyOn(apiClient, "sendAnnouncement").mockResolvedValue({ delivered: 1, intended: 1, unreachable: [], archivedCount: 0 });

    const el = await mount();
    await type(textareaByLabel(el, "Текст анонса"), "Планёрка в пятницу в 10:00");

    act(() => buttonByText(el, "Отправить").click());
    expect(send).not.toHaveBeenCalled();

    await act(async () => buttonByText(el, "Да, отправить").click());
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  // Правка галочек гасит пресет (toggle), поэтому «Админам» после неё уже не нажата и
  // сбрасывает выбор сама. Единственное, что даёт именно повторный клик по нажатому, —
  // отмена ожидающего подтверждения: передумал отправлять — нажал аудиторию заново.
  it.each(["Всем", "Админам"])("повторное нажатие на «%s» снимает запрошенное подтверждение", async (audience) => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue([
      recipient({ id: 1, displayName: "Аня", role: "admin" }),
    ]);
    const el = await mount();
    await type(textareaByLabel(el, "Текст анонса"), "Планёрка");
    act(() => buttonByText(el, audience).click());
    act(() => buttonByText(el, "Отправить").click());
    expect(buttonByText(el, "Да, отправить")).toBeTruthy();

    act(() => buttonByText(el, audience).click());
    expect(() => buttonByText(el, "Да, отправить")).toThrow();
  });

  it.each([
    ["Админам", [1]],
    ["Работникам", [2]],
  ])("«%s» отмечает свою роль, наблюдатель не попадает никуда", async (button, ids) => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue([
      recipient({ id: 1, displayName: "Аня", role: "admin" }),
      recipient({ id: 2, displayName: "Игорь", role: "worker" }),
      recipient({ id: 3, displayName: "Лена", role: "observer" }),
    ]);
    const send = vi.spyOn(apiClient, "sendAnnouncement").mockResolvedValue({ delivered: 1, intended: 1, unreachable: [], archivedCount: 0 });

    const el = await mount();
    await type(textareaByLabel(el, "Текст анонса"), "Новое в журнале");
    act(() => buttonByText(el, button).click());
    // Галочки видны: отправитель может поправить список до отправки.
    expect(pickerRow(el, "Лена").querySelector("input")!.checked).toBe(false);

    act(() => buttonByText(el, "Отправить").click());
    await act(async () => buttonByText(el, "Да, отправить").click());
    await settle();
    expect(send).toHaveBeenCalledWith("Новое в журнале", ids);
  });

  it("при «Выбрать» без единой галки отправка недоступна, с одной — доступна", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue([
      recipient({ id: 1, displayName: "Аня" }),
      recipient({ id: 2, displayName: "Игорь" }),
    ]);

    const el = await mount();
    await type(textareaByLabel(el, "Текст анонса"), "Текст");
    act(() => buttonByText(el, "Выбрать").click());

    expect(buttonByText(el, "Отправить").disabled).toBe(true);

    await act(async () => checkboxIn(pickerRow(el, "Аня")).click());
    expect(buttonByText(el, "Отправить").disabled).toBe(false);
  });

  it("пустой текст блокирует отправку, текст длиннее лимита — тоже", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue([recipient()]);

    const el = await mount();
    // Пустой текст — кнопка ещё не взведена изначально.
    expect(buttonByText(el, "Отправить").disabled).toBe(true);

    await type(textareaByLabel(el, "Текст анонса"), "Норм текст");
    expect(buttonByText(el, "Отправить").disabled).toBe(false);

    await type(textareaByLabel(el, "Текст анонса"), "ф".repeat(ANNOUNCEMENT_TEXT_MAX + 1));
    expect(buttonByText(el, "Отправить").disabled).toBe(true);
  });

  it("недостижимый показан и помечен, но не входит в число «кому уйдёт»", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue([
      recipient({ id: 1, displayName: "Аня", reachable: true }),
      recipient({ id: 2, displayName: "Марк", reachable: false }),
    ]);

    const el = await mount();
    act(() => buttonByText(el, "Выбрать").click());

    const markRow = pickerRow(el, "Марк");
    expect(markRow.textContent).toContain("не привязан");

    await act(async () => {
      checkboxIn(pickerRow(el, "Аня")).click();
      checkboxIn(markRow).click();
    });

    // «Уйдёт 1:» — Марк выбран, но не достижим, и в счётчик не идёт.
    expect(el.textContent).toContain("Уйдёт 1:");
    const recipientsChips = [...el.querySelectorAll(".birthday-recipient")].map((c) => c.textContent);
    expect(recipientsChips).toEqual(["Аня"]);
  });

  it("отчёт после отправки называет недошедших поимённо", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue([recipient({ id: 1, displayName: "Аня" })]);
    vi.spyOn(apiClient, "sendAnnouncement").mockResolvedValue({
      delivered: 1,
      intended: 2,
      unreachable: ["Игорь"],
      archivedCount: 0,
    });

    const el = await mount();
    await type(textareaByLabel(el, "Текст анонса"), "Текст");
    act(() => buttonByText(el, "Отправить").click());
    await act(async () => buttonByText(el, "Да, отправить").click());
    await settle();

    expect(el.textContent).toContain("Дошло 1 из 2");
    expect(el.textContent).toContain("Игорь");
  });

  // Баг из ledger: архивный в отчёте не называется по имени — только числом.
  it("отчёт про архивных — числом, без единого имени бывшего сотрудника", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue([recipient({ id: 1, displayName: "Аня" })]);
    vi.spyOn(apiClient, "sendAnnouncement").mockResolvedValue({
      delivered: 1,
      intended: 3,
      unreachable: [],
      archivedCount: 2,
    });

    const el = await mount();
    await type(textareaByLabel(el, "Текст анонса"), "Текст");
    act(() => buttonByText(el, "Отправить").click());
    await act(async () => buttonByText(el, "Да, отправить").click());
    await settle();

    expect(el.textContent).toContain("Не дошло: 2 — в архиве");
  });
});

/** Какие пункты «Кому отправить» нажаты: по ним админ узнаёт, кому уйдёт неотзываемое сообщение. */
function pressedAudience(el: HTMLElement): string[] {
  const group = el.querySelector('[aria-label="Кому отправить"]')!;
  return [...group.querySelectorAll<HTMLButtonElement>("button")]
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => (b.textContent ?? "").trim());
}

describe("AnnounceScreen: нажатый пункт аудитории", () => {
  const TEAM = [
    recipient({ id: 1, displayName: "Аня", role: "admin" }),
    recipient({ id: 2, displayName: "Игорь", role: "worker" }),
    recipient({ id: 3, displayName: "Марк", role: "worker" }),
  ];

  it.each(["Всем", "Админам", "Работникам", "Выбрать"])("после «%s» нажат ровно он", async (label) => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue(TEAM);
    const el = await mount();
    // Сначала уходим с исходного «Всем» на другой пункт, чтобы «Всем» проверялось возвратом.
    act(() => buttonByText(el, label === "Выбрать" ? "Админам" : "Выбрать").click());
    act(() => buttonByText(el, label).click());
    expect(pressedAudience(el)).toEqual([label]);
  });

  it("при открытии нажато «Всем»", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue(TEAM);
    const el = await mount();
    expect(pressedAudience(el)).toEqual(["Всем"]);
  });

  it.each(["Админам", "Работникам"])("галочка под пресетом «%s» переводит нажатие на «Выбрать»", async (preset) => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue(TEAM);
    const el = await mount();
    act(() => buttonByText(el, preset).click());
    expect(pressedAudience(el)).toEqual([preset]);

    await act(async () => checkboxIn(pickerRow(el, "Марк")).click());
    expect(pressedAudience(el)).toEqual(["Выбрать"]);

    // Снятие галочки — тоже ручная правка: пресет не возвращается.
    act(() => buttonByText(el, preset).click());
    await act(async () => checkboxIn(pickerRow(el, "Аня")).click());
    expect(pressedAudience(el)).toEqual(["Выбрать"]);
  });

  it("выбрана группа — не нажат ни один пункт аудитории", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue(TEAM);
    vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue([{ id: 7, name: "ЧИП 5-й этаж", memberIds: [2, 3] }]);
    const el = await mount();
    act(() => buttonByText(el, "ЧИП 5-й этаж").click());
    expect(pressedAudience(el)).toEqual([]);
  });

  it("пока отправка не завершилась, все четыре пункта аудитории недоступны", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue(TEAM);
    vi.spyOn(apiClient, "sendAnnouncement").mockReturnValue(new Promise(() => {}));
    const el = await mount();
    await type(textareaByLabel(el, "Текст анонса"), "Планёрка");
    act(() => buttonByText(el, "Отправить").click());
    await act(async () => buttonByText(el, "Да, отправить").click());

    for (const label of ["Всем", "Админам", "Работникам", "Выбрать"]) {
      expect(buttonByText(el, label).disabled, label).toBe(true);
    }
  });
});

describe("AnnounceScreen: кнопки групп", () => {
  const TEAM = [
    recipient({ id: 1, displayName: "Аня" }),
    recipient({ id: 2, displayName: "Игорь" }),
    recipient({ id: 3, displayName: "Марк" }),
  ];
  const GROUPS: RecipientGroupView[] = [{ id: 7, name: "ЧИП 5-й этаж", memberIds: [2, 3, 99] }];

  it("группа отмечает свой состав (чужой id отбрасывается) и уходит списком", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue(TEAM);
    vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue(GROUPS);
    const send = vi.spyOn(apiClient, "sendAnnouncement").mockResolvedValue({ delivered: 2, intended: 2, unreachable: [], archivedCount: 0 });
    const el = await mount();
    await type(textareaByLabel(el, "Текст анонса"), "Завтра сбор");
    act(() => buttonByText(el, "ЧИП 5-й этаж").click());
    act(() => buttonByText(el, "Отправить").click());
    await act(async () => buttonByText(el, "Да, отправить").click());
    await settle();
    expect(send).toHaveBeenCalledWith("Завтра сбор", [2, 3]);
  });

  it("ручная галочка после группы снимает подсветку", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue(TEAM);
    vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue(GROUPS);
    const el = await mount();
    expect(el.querySelector("[data-testid=group-row]")).not.toBeNull();
    act(() => buttonByText(el, "ЧИП 5-й этаж").click());
    expect(buttonByText(el, "ЧИП 5-й этаж").className).toContain("btn-primary");
    await act(async () => checkboxIn(pickerRow(el, "Аня")).click());
    expect(buttonByText(el, "ЧИП 5-й этаж").className).not.toContain("btn-primary");
  });

  it("без групп и при сбое загрузки ряда нет, экран работает", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue(TEAM);
    vi.spyOn(apiClient, "getRecipientGroups").mockRejectedValue(new Error("сеть"));
    const el = await mount();
    expect(el.querySelector("[data-testid=group-row]")).toBeNull();
    expect(buttonByText(el, "Выбрать")).toBeTruthy();
  });
});
