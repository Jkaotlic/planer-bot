// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Collection, type UpcomingBirthday } from "./api/client";
import { CollectionsScreen } from "./screens/CollectionsScreen";

/**
 * Баг из ledger: экран сам считал «сегодня» часами браузера (`todayIso()`,
 * built on `new Date()`) — статус карточки и подпись автоотправки расходились
 * с командной датой, если браузер в другом часовом поясе. Теперь «сегодня»
 * приходит из `asOf`, который отдаёт `GET /api/admin/birthdays` (командный
 * `teamNow` на сервере), а не считается на клиенте.
 *
 * Сценарий: браузер уверен, что уже следующая неделя, сервер — что ещё нет.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SERVER_TODAY = "2026-09-01";
const BROWSER_TODAY = "2026-09-08"; // неделя вперёд — браузер «спешит»

const ROUND: Collection = {
  id: 7, kind: "birthday", employeeId: 1, year: 2026, celebratedOn: "2026-09-14",
  title: null, eventDate: null, deadline: null, amountPerPerson: null, totalGoal: null,
  collectUrl: "https://example.com/sbor", messageText: null, closedAt: null,
  scheduledSendOn: null, scheduleNotifiedAt: null,
  // Между серверным и браузерным «сегодня»: по браузеру это уже прошло
  // («сегодня»), по серверу — ещё нет.
  autoSendOn: "2026-09-04", autoSentAt: null,
  sentAt: null, sentCount: 0, sendCount: 0, createdAt: "2026-08-01T10:00:00Z",
};

const BIRTHDAY: UpcomingBirthday = {
  employeeId: 1, displayName: "Марк", birthDate: "09-14", birthDateLabel: "14 сентября",
  celebratedOn: "2026-09-14", daysUntil: 13, campaign: ROUND,
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

async function mount(birthday: UpcomingBirthday) {
  vi.spyOn(apiClient, "getBirthdays").mockResolvedValue({ asOf: SERVER_TODAY, birthdays: [birthday] });
  vi.spyOn(apiClient, "getCollections").mockResolvedValue([]);
  vi.spyOn(apiClient, "getEmployees").mockResolvedValue([]);

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(CollectionsScreen)); });
  await settle();
  return host;
}

describe("CollectionsScreen — команднАЯ дата (asOf), не часы браузера", () => {
  it("метка автоотправки читает asOf с сервера, а не спешащий браузер", async () => {
    vi.setSystemTime(new Date(`${BROWSER_TODAY}T12:00:00Z`));

    const el = await mount(BIRTHDAY);

    // По браузеру (2026-09-08) autoSendOn (2026-09-04) уже прошёл — было бы
    // «сегодня». По серверному asOf (2026-09-01) он ещё впереди — «4 сентября».
    expect(el.textContent).toContain("Бот разошлёт команде 4 сентября");
    expect(el.textContent).not.toContain("Бот разошлёт команде сегодня");
  });
});
