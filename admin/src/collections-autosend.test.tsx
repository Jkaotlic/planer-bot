// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Collection, type UpcomingBirthday } from "./api/client";
import { CollectionsScreen } from "./screens/CollectionsScreen";

/**
 * Зеркало `miniapp/src/screens/admin/AdminCollections-autosend.test.tsx`.
 *
 * Два фронта показывают один экран, и состояние «бот разошлёт сам» обязано
 * читаться на обоих одинаково: админ, открывший браузерную консоль, не должен
 * узнавать про автоотправку из чужой переписки с ботом.
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
  vi.spyOn(apiClient, "getEmployees").mockResolvedValue([]);

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(CollectionsScreen)); });
  await settle();
  return host;
}

describe("автоотправка на карточке дня рождения в консоли", () => {
  it("говорит, когда бот разошлёт сам", async () => {
    const el = await mount(BIRTHDAY);

    expect(el.textContent).toContain("Бот разошлёт команде 4 сентября");
  });

  it("выключенная автоотправка честно говорит, что ждут тебя", async () => {
    const el = await mount({ ...BIRTHDAY, campaign: { ...ROUND, autoSendOn: null } });

    expect(el.textContent).toContain("Разошлёшь сам");
    expect(el.textContent).not.toContain("Бот разошлёт");
  });

  it("чекбокс выключает автоотправку — на сервер уходит null", async () => {
    const update = vi.spyOn(apiClient, "saveBirthdayRound").mockResolvedValue({} as never);
    const el = await mount(BIRTHDAY);

    const toggle = el.querySelector<HTMLInputElement>('input[aria-label="Бот рассылает сам"]')!;
    await act(async () => { toggle.click(); });
    await settle();

    expect(update).toHaveBeenCalledWith(1, { autoSendOn: null });
  });

  it("чекбокс включает автоотправку обратно — на день за три до праздника", async () => {
    const update = vi.spyOn(apiClient, "saveBirthdayRound").mockResolvedValue({} as never);
    const el = await mount({ ...BIRTHDAY, campaign: { ...ROUND, autoSendOn: null } });

    const toggle = el.querySelector<HTMLInputElement>('input[aria-label="Бот рассылает сам"]')!;
    await act(async () => { toggle.click(); });
    await settle();

    expect(update).toHaveBeenCalledWith(1, { autoSendOn: "2099-09-04" });
  });

  /**
   * Зеркало мини-апповского случая, и по той же причине: `autoSendOn` после
   * рассылки никто не гасит, поэтому строка «разошлёт сегодня» жила бы рядом с
   * «Разослано · 14» до самого праздника.
   */
  it("у разосланного сбора строки про будущую рассылку нет вовсе", async () => {
    const el = await mount({
      ...BIRTHDAY,
      campaign: { ...ROUND, sendCount: 1, sentCount: 14, sentAt: "2099-09-04T10:00:00Z", autoSentAt: "2099-09-04T10:00:00Z" },
    });

    expect(el.textContent).toContain("Разослано · 14");
    expect(el.textContent).not.toContain("Бот разошлёт");
    expect(el.textContent).not.toContain("Разошлёшь сам");
    expect(el.querySelector('input[aria-label="Бот рассылает сам"]')).toBeNull();
  });

  it("вводный абзац больше не обещает, что команде ничего не уйдёт", async () => {
    const el = await mount(BIRTHDAY);

    expect(el.textContent).not.toContain("пока ты сам не нажмёшь");
  });
});
