// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Collection, type CollectionRow } from "./api/client";
import { CollectionsScreen } from "./screens/CollectionsScreen";

/**
 * «Собрали» прямо в строке списка — зеркало теста мини-аппа
 * (`miniapp/src/screens/admin/collections-close-row.test.tsx`): один экран на
 * двух фронтах, и закрывать сбор на них надо одинаково.
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
  vi.spyOn(apiClient, "getEmployees").mockResolvedValue([]);
  vi.spyOn(apiClient, "getCollections").mockResolvedValue(rows);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(CollectionsScreen));
  });
  await settle();
  return host;
}

function button(el: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label);
}

describe("кнопка «Собрали» в строке списка (консоль)", () => {
  it("закрывает сбор, не раскрывая карточку", async () => {
    const close = vi.spyOn(apiClient, "setCollectionClosed")
      .mockResolvedValue({ ...COLLECTION, closedAt: "2026-08-24T10:00:00Z" });

    const el = await mount([ROW]);
    await act(async () => button(el, "Собрали")!.click());
    await settle();

    expect(close).toHaveBeenCalledWith(3, true);
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
});
