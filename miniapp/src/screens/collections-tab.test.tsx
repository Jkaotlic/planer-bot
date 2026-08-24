// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type WorkerCollection } from "../api/client";
import { CollectionsTabScreen } from "./CollectionsTabScreen";

/**
 * Вкладка «Сборы» у работника.
 *
 * Секция во вкладке «Команда», которую она заменила, умела исчезать целиком —
 * отдельная вкладка исчезнуть не может, и пустой экран без слов читался бы как
 * «не загрузилось».
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COLLECTION: WorkerCollection = {
  id: 3, title: "Кофемашина", personName: null, collectUrl: null,
  amountPerPerson: null, totalGoal: null, deadline: null, eventDate: null,
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
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

async function mount(isAdmin: boolean) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(CollectionsTabScreen, { isAdmin })));
  });
  await settle();
  return host;
}

describe("вкладка «Сборы»", () => {
  it("работнику показывает слова, а не пустоту", async () => {
    vi.spyOn(apiClient, "getMyCollections").mockResolvedValue([]);
    const el = await mount(false);
    expect(el.textContent ?? "").toContain("Сейчас сборов нет");
  });

  it("работнику показывает идущий сбор", async () => {
    vi.spyOn(apiClient, "getMyCollections").mockResolvedValue([COLLECTION]);
    const el = await mount(false);
    expect(el.textContent ?? "").toContain("Кофемашина");
    expect(el.textContent ?? "").not.toContain("Сейчас сборов нет");
  });

  it("не роняет экран, когда сборы не загрузились", async () => {
    // График команды раньше не пропадал из-за упавшего сбора; вкладка тем более
    // не должна показывать пустой белый лист.
    vi.spyOn(apiClient, "getMyCollections").mockRejectedValue(new Error("Failed to fetch"));
    const el = await mount(false);
    expect(el.textContent ?? "").toContain("Сейчас сборов нет");
  });
});
