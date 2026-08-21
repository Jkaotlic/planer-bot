// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Collection, type CollectionRow, type Me, type UpcomingBirthday } from "../../api/client";
import { AdminCollections } from "./AdminCollections";

/**
 * Его правка от 2026-08-21: живые сборы лежали под всем календарём дней
 * рождения — до того, ради чего экран открывают чаще всего, надо было
 * прокрутить год чужих праздников. Зеркало теста консоли
 * (`admin/src/collections-screen.test.tsx`): два фронта показывают один экран,
 * и порядок секций на них обязан совпадать.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COLLECTION: Collection = {
  id: 3, kind: "custom", employeeId: null, year: null, celebratedOn: null,
  title: "Кофемашина", eventDate: null, deadline: null, amountPerPerson: null, totalGoal: null,
  collectUrl: null, messageText: null, closedAt: null,
  scheduledSendOn: null, scheduleNotifiedAt: null, sentAt: null, sentCount: 0, sendCount: 0,
  createdAt: "2026-08-01T10:00:00Z",
};

const ROW: CollectionRow = { collection: COLLECTION, personName: null, title: "Кофемашина", status: "pending", active: true };

const BIRTHDAY: UpcomingBirthday = {
  employeeId: 1, displayName: "Волков Илья", birthDate: "08-25", birthDateLabel: "25 августа",
  celebratedOn: "2026-08-25", daysUntil: 4, campaign: null,
};

const ME: Me = {
  id: 9, displayName: "Админ Админов", address: "Админ", preferredName: null,
  isAdmin: true, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, canAnnounce: true,
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
    root!.render(createElement(AppRoot, null, createElement(AdminCollections)));
  });
  await settle();
  return host;
}

describe("порядок секций на экране «Сборы»", () => {
  it("ставит идущие сборы выше календаря дней рождения", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([BIRTHDAY]);
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([ROW]);
    vi.spyOn(apiClient, "getMe").mockResolvedValue(ME);
    vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([]);

    const el = await mount();
    const text = el.textContent ?? "";
    expect(text).toContain("Идут сборы");
    expect(text.indexOf("Идут сборы")).toBeLessThan(text.indexOf("Ближайшие дни рождения"));
    expect(text.indexOf("Идут сборы")).toBeLessThan(text.indexOf("Новый сбор"));
  });
});
