// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type UpcomingBirthday, type BirthdayPreview, type CampaignListRow } from "../../api/client";
import { AdminBirthdays } from "./AdminBirthdays";

/**
 * Рассылка ДР не говорила, до скольких из скольких дошло — ровно тот дефект,
 * что уже чинили для «Работы в выходной» (reachNotice) и для сохранения записи,
 * импорта, распределения и «Заполнить неделю» (notifyNotice) в этой же сессии.
 * Здесь `onSent` пробрасывал только `delivered`, `intended` отбрасывался.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom не реализует scrollIntoView — компонент зовёт его при открытии карточки.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

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
    scheduledSendOn: null, scheduleNotifiedAt: null,
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
    root!.render(createElement(AppRoot, null, createElement(AdminBirthdays)));
  });
  await settle();
  return host;
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
  if (!found) throw new Error(`не нашёл кнопку с текстом «${text}»`);
  return found;
}

describe("рассылка ДР говорит, до скольких дошло", () => {
  it("дошло не до всех — строка про N из M видна", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([BIRTHDAY]);
    vi.spyOn(apiClient, "getBirthdayCampaigns").mockResolvedValue([] as CampaignListRow[]);
    vi.spyOn(apiClient, "getBirthdayPreview").mockResolvedValue(PREVIEW);
    vi.spyOn(apiClient, "sendBirthday").mockResolvedValue({ delivered: 1, intended: 3 });

    const el = await mount();
    await act(async () => buttonByText(el, "Подготовить сбор").click());
    await settle();
    await act(async () => buttonByText(el, "Разослать").click());
    await settle();
    await act(async () => buttonByText(el, "Да, разослать").click());
    await settle();

    expect(el.textContent ?? "").toContain("дошло до 1 из 3");
  });
});
