// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Collection, type Me, type UpcomingBirthday } from "../../api/client";
import { AdminCollections } from "./AdminCollections";

/**
 * Баг из ledger: экран сам считал «сегодня» часами телефона (`toISODate(new
 * Date())`) — статус карточки и минимум даты напоминания расходились с
 * командной датой, если телефон в другом часовом поясе или его часы просто
 * врут. Теперь «сегодня» приходит пропом `today` из bootstrap
 * (`App.tsx` → `data.today`, тот же путь, что уже возит его в `TeamScreen` и
 * `AdminScreen`), а не от `new Date()` внутри экрана.
 *
 * Сценарий: телефон уверен, что уже следующая неделя, сервер — что ещё нет.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SERVER_TODAY = "2026-09-01";
const PHONE_TODAY = "2026-09-08"; // неделя вперёд — телефон «спешит»

const ROUND: Collection = {
  id: 7, kind: "birthday", employeeId: 1, year: 2026, celebratedOn: "2026-09-14",
  title: null, eventDate: null, deadline: null, amountPerPerson: null, totalGoal: null,
  collectUrl: "https://example.com/sbor", messageText: null, closedAt: null,
  scheduledSendOn: null, scheduleNotifiedAt: null,
  // Между серверным и телефонным «сегодня»: по телефону это уже прошло
  // («сегодня»), по серверу — ещё нет.
  autoSendOn: "2026-09-04", autoSentAt: null,
  sentAt: null, sentCount: 0, sendCount: 0, createdAt: "2026-08-01T10:00:00Z",
};

const BIRTHDAY: UpcomingBirthday = {
  employeeId: 1, displayName: "Марк", birthDate: "09-14", birthDateLabel: "14 сентября",
  celebratedOn: "2026-09-14", daysUntil: 13, campaign: ROUND,
};

const ME: Me = {
  id: 9, displayName: "Игорь", address: "Игорь", preferredName: null,
  isAdmin: true, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, startTab: null, canAnnounce: true,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function settle(times = 10) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

async function mount(birthday: UpcomingBirthday, today: string) {
  vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([birthday]);
  vi.spyOn(apiClient, "getCollections").mockResolvedValue([]);
  vi.spyOn(apiClient, "getMe").mockResolvedValue(ME);
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([]);

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(AdminCollections, { today }))); });
  await settle();
  return host;
}

describe("AdminCollections — команднАЯ дата, не часы телефона", () => {
  it("метка автоотправки читает серверный today, а не спешащий телефон", async () => {
    vi.setSystemTime(new Date(`${PHONE_TODAY}T12:00:00Z`));

    const el = await mount(BIRTHDAY, SERVER_TODAY);

    // По телефону (2026-09-08) autoSendOn (2026-09-04) уже прошёл — было бы
    // «сегодня». По серверу (2026-09-01) он ещё впереди — «4 сентября».
    expect(el.textContent).toContain("Бот разошлёт команде 4 сентября");
    expect(el.textContent).not.toContain("Бот разошлёт команде сегодня");
  });

  it("минимум поля «Напомнить мне» — серверный today, а не дата телефона", async () => {
    vi.setSystemTime(new Date(`${PHONE_TODAY}T12:00:00Z`));

    const el = await mount({ ...BIRTHDAY, campaign: { ...ROUND, collectUrl: null } }, SERVER_TODAY);
    await act(async () => {
      const open = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Подготовить сбор"));
      open?.click();
    });
    await settle();

    const input = el.querySelector<HTMLInputElement>('input[aria-label="Дата напоминания о сборе"]');
    expect(input?.min).toBe(SERVER_TODAY);
    expect(input?.min).not.toBe(PHONE_TODAY);
  });
});
