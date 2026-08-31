// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Collection, type Me, type UpcomingBirthday } from "../../api/client";
import { AdminCollections } from "./AdminCollections";

/**
 * Состояние «письмо уйдёт само» обязано быть видно на экране, а не только в
 * переписке одного админа с ботом: второй админ открывает «Сборы», видит сбор
 * со ссылкой без пометки — и рассылает второй раз руками.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROUND: Collection = {
  id: 7, kind: "birthday", employeeId: 1, year: 2026, celebratedOn: "2099-09-07",
  title: null, eventDate: null, deadline: null, amountPerPerson: null, totalGoal: null,
  collectUrl: "https://example.com/sbor", messageText: null, closedAt: null,
  scheduledSendOn: null, scheduleNotifiedAt: null, autoSendOn: "2099-09-04", autoSentAt: null,
  sentAt: null, sentCount: 0, sendCount: 0, createdAt: "2026-09-01T10:00:00Z",
};

const BIRTHDAY: UpcomingBirthday = {
  employeeId: 1, displayName: "Марк", birthDate: "09-07", birthDateLabel: "7 сентября",
  celebratedOn: "2099-09-07", daysUntil: 6, campaign: ROUND,
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
});

async function settle(times = 10) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

async function mount(birthday: UpcomingBirthday) {
  vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([birthday]);
  vi.spyOn(apiClient, "getCollections").mockResolvedValue([]);
  vi.spyOn(apiClient, "getMe").mockResolvedValue(ME);
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([]);

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(AdminCollections))); });
  await settle();
  return host;
}

describe("автоотправка на карточке дня рождения", () => {
  it("говорит, когда бот разошлёт сам", async () => {
    const el = await mount(BIRTHDAY);

    expect(el.textContent).toContain("Бот разошлёт команде 4 сентября");
  });

  it("выключенная автоотправка честно говорит, что ждут тебя", async () => {
    const el = await mount({ ...BIRTHDAY, campaign: { ...ROUND, autoSendOn: null } });

    expect(el.textContent).toContain("Разошлёшь сам");
    expect(el.textContent).not.toContain("Бот разошлёт");
  });

  it("тумблер выключает автоотправку — на сервер уходит null", async () => {
    const update = vi.spyOn(apiClient, "saveBirthdayRound").mockResolvedValue({} as never);
    const el = await mount(BIRTHDAY);

    const toggle = el.querySelector<HTMLInputElement>('input[aria-label="Бот рассылает сам"]')!;
    await act(async () => { toggle.click(); });
    await settle();

    expect(update).toHaveBeenCalledWith(1, { autoSendOn: null });
  });

  it("тумблер включает автоотправку обратно — на день за три до праздника", async () => {
    const update = vi.spyOn(apiClient, "saveBirthdayRound").mockResolvedValue({} as never);
    const el = await mount({ ...BIRTHDAY, campaign: { ...ROUND, autoSendOn: null } });

    const toggle = el.querySelector<HTMLInputElement>('input[aria-label="Бот рассылает сам"]')!;
    await act(async () => { toggle.click(); });
    await settle();

    expect(update).toHaveBeenCalledWith(1, { autoSendOn: "2099-09-04" });
  });

  it("вводный текст секции больше не обещает, что команде ничего не уйдёт", async () => {
    const el = await mount(BIRTHDAY);

    expect(el.textContent).not.toContain("пока ты сам не нажмёшь");
  });
});
