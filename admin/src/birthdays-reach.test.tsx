// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type UpcomingBirthday, type BirthdayPreview } from "./api/client";
import { App } from "./App";

/**
 * Рассылка ДР не говорила, до скольких из скольких дошло — тот же дефект, что
 * уже чинили для «Работы в выходной» (reachNotice) и для импорта CSV/сохранения
 * записи (notifyNotice) в этой же сессии. `onSent` пробрасывал только
 * `delivered`, `intended` отбрасывался молча.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BIRTHDAY: UpcomingBirthday = {
  employeeId: 1,
  displayName: "Волков Илья",
  birthDate: "08-05",
  birthDateLabel: "5 августа",
  celebratedOn: "2026-08-05",
  daysUntil: 2,
  campaign: {
    id: 1, employeeId: 1, year: 2026, celebratedOn: "2026-08-05",
    collectUrl: "https://sber.ru/x", messageText: null, status: "ready",
    adminNotifiedAt: null, sentAt: null, sentCount: 0,
  },
};

const PREVIEW: BirthdayPreview = {
  employeeId: 1, displayName: "Волков Илья", celebratedOn: "2026-08-05",
  collectUrl: "https://sber.ru/x", message: "текст сбора",
  recipients: [{ employeeId: 2, displayName: "Кто-то" }],
  blocker: null, alreadySentAt: null,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 20) {
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
    root!.render(createElement(App));
  });
  await settle();
  return host;
}

function byText(el: HTMLElement, selector: string, text: string): HTMLElement {
  const found = [...el.querySelectorAll(selector)].find((node) => (node.textContent ?? "").trim() === text);
  if (!found) throw new Error(`не нашёл ${selector} с подписью «${text}»`);
  return found as HTMLElement;
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
  if (!found) throw new Error(`не нашёл кнопку с текстом «${text}»`);
  return found;
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
  await settle();
}

describe("рассылка ДР говорит, до скольких дошло (консоль)", () => {
  it("дошло не до всех — строка про N из M видна", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([BIRTHDAY]);
    vi.spyOn(apiClient, "getBirthdayPreview").mockResolvedValue(PREVIEW);
    vi.spyOn(apiClient, "sendBirthday").mockResolvedValue({ delivered: 1, intended: 3 });

    const el = await mount();
    await click(byText(el, ".sidebar-nav-item", "Дни рождения"));
    await click(buttonByText(el, "Подготовить сбор"));
    await click(buttonByText(el, "Разослать"));
    await click(buttonByText(el, "Да, разослать"));

    expect(el.textContent ?? "").toContain("дошло до 1 из 3");
  });
});
