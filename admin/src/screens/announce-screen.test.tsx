// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANNOUNCEMENT_TEXT_MAX, apiClient, type AnnouncementRecipient } from "../api/client";
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
  return { id: 1, displayName: "Аня", reachable: true, ...patch };
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
    const send = vi.spyOn(apiClient, "sendAnnouncement").mockResolvedValue({ delivered: 1, intended: 1, unreachable: [] });

    const el = await mount();
    await type(textareaByLabel(el, "Текст анонса"), "Планёрка в пятницу в 10:00");

    act(() => buttonByText(el, "Отправить").click());
    expect(send).not.toHaveBeenCalled();

    await act(async () => buttonByText(el, "Да, отправить").click());
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
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
    });

    const el = await mount();
    await type(textareaByLabel(el, "Текст анонса"), "Текст");
    act(() => buttonByText(el, "Отправить").click());
    await act(async () => buttonByText(el, "Да, отправить").click());
    await settle();

    expect(el.textContent).toContain("Дошло 1 из 2");
    expect(el.textContent).toContain("Игорь");
  });
});
