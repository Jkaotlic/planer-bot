// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Collection, type CollectionRow, type Me } from "../../api/client";
import { AdminCollections } from "./AdminCollections";

/**
 * «Собрали» прямо в строке списка.
 *
 * Закрыть сбор можно было только изнутри карточки: открыть, прокрутить до низа,
 * нажать. Это самое частое, что со сбором делают, и трёх движений оно не стоит.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COLLECTION: Collection = {
  id: 3, kind: "custom", employeeId: null, year: null, celebratedOn: null,
  title: "Кофемашина", eventDate: null, deadline: null, amountPerPerson: null, totalGoal: null,
  collectUrl: null, messageText: null, closedAt: null,
  scheduledSendOn: null, scheduleNotifiedAt: null, autoSendOn: null, autoSentAt: null, sentAt: null, sentCount: 0, sendCount: 0,
  createdAt: "2026-08-01T10:00:00Z",
};

const ROW: CollectionRow = { collection: COLLECTION, personName: null, title: "Кофемашина", status: "pending", active: true };

const ME: Me = {
  id: 9, displayName: "Аня Смирнова", address: "Аня", preferredName: null,
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

async function settle(times = 12) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

async function mount(rows: CollectionRow[]) {
  vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
  vi.spyOn(apiClient, "getCollections").mockResolvedValue(rows);
  vi.spyOn(apiClient, "getMe").mockResolvedValue(ME);
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminCollections)));
  });
  await settle();
  return host;
}

function button(el: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label);
}

describe("кнопка «Собрали» в строке списка", () => {
  it("закрывает сбор, не раскрывая карточку", async () => {
    const close = vi.spyOn(apiClient, "setCollectionClosed")
      .mockResolvedValue({ ...COLLECTION, closedAt: "2026-08-24T10:00:00Z" });

    const el = await mount([ROW]);
    await act(async () => button(el, "Собрали")!.click());
    await settle();

    expect(close).toHaveBeenCalledWith(3, true);
    // Карточка осталась свёрнутой: кнопка на строке — про «не открывая».
    expect(button(el, "Свернуть")).toBeUndefined();
  });

  it("у закрытого сбора кнопки в строке нет", async () => {
    const closed: CollectionRow = {
      ...ROW, active: false, status: "sent",
      collection: { ...COLLECTION, closedAt: "2026-08-20T10:00:00Z" },
    };
    const el = await mount([closed]);
    expect(button(el, "Собрали")).toBeUndefined();
  });

  it("отказ виден на самой строке", async () => {
    vi.spyOn(apiClient, "setCollectionClosed").mockRejectedValue(new Error("Failed to fetch"));
    const el = await mount([ROW]);
    await act(async () => button(el, "Собрали")!.click());
    await settle();
    expect(el.textContent ?? "").toContain("Не получилось закрыть сбор");
  });
});
