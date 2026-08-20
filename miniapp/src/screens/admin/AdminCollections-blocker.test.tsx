// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Collection, type CollectionPreview, type CollectionRow, type Me } from "../../api/client";
import { AdminCollections } from "./AdminCollections";

/**
 * Зеркало `admin/src/collections-blocker.test.tsx` — то же поведение, другая
 * разметка (общего UI-пакета между воркспейсами нет).
 *
 * Владелец создал сбор и не нашёл кнопку отправки. Причина была написана
 * (`blocker`: «Нет ссылки на сбор…»), но она ЗАМЕНЯЛА кнопку абзацем, а здесь
 * это бьёт сильнее, чем в консоли: блокер набран тем же серым мелким шрифтом,
 * что и соседние пояснения, — то есть на месте кнопки человек видел ещё один
 * абзац текста.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NO_LINK = "Нет ссылки на сбор — вставь её, прежде чем рассылать.";

const ME: Me = {
  id: 9, displayName: "Админ Админов", address: "Админ", preferredName: null,
  isAdmin: true, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, canAnnounce: true,
};

function collection(patch: Partial<Collection> = {}): Collection {
  return {
    id: 1, kind: "custom", employeeId: null, year: null, celebratedOn: null,
    title: "Кофемашина", eventDate: null, deadline: null,
    amountPerPerson: null, totalGoal: null, collectUrl: null, messageText: null,
    closedAt: null, scheduledSendOn: null, scheduleNotifiedAt: null,
    sentAt: null, sentCount: 0, sendCount: 0, createdAt: "2026-08-01T10:00:00Z",
    ...patch,
  };
}

function row(patch: Partial<CollectionRow> & { collection: Collection }): CollectionRow {
  return { personName: null, title: patch.collection.title ?? "Сбор", status: "pending", active: true, ...patch };
}

function preview(patch: Partial<CollectionPreview> = {}): CollectionPreview {
  return {
    id: 1, kind: "custom", title: "Кофемашина", personName: null, employeeId: null,
    collectUrl: null, message: "текст сбора",
    recipients: [{ employeeId: 2, displayName: "Кто-то" }],
    blocker: null, sendCount: 0, lastSentAt: null,
    ...patch,
  };
}

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
      await new Promise((resolve) => setTimeout(resolve, 12));
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

function sendButton(el: HTMLElement): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Разослать"));
  if (!found) throw new Error("кнопки рассылки на экране нет вовсе");
  return found;
}

async function openCard(el: HTMLElement) {
  const open = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Открыть");
  if (!open) throw new Error("не нашёл кнопку «Открыть» у строки сбора");
  await act(async () => open.click());
  await settle();
}

describe("блокер рассылки не прячет кнопку (мини-апп)", () => {
  it("кнопка на месте, погашена, и причина написана рядом", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
    vi.spyOn(apiClient, "getMe").mockResolvedValue(ME);
    vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([]);
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([row({ collection: collection() })]);
    vi.spyOn(apiClient, "getCollectionPreview").mockResolvedValue(preview({ blocker: NO_LINK }));
    const send = vi.spyOn(apiClient, "sendCollection").mockResolvedValue({ delivered: 1, intended: 1, round: 1 });

    const el = await mount();
    await openCard(el);

    const button = sendButton(el);
    expect(button.disabled).toBe(true);
    expect(el.textContent ?? "").toContain(NO_LINK);

    await act(async () => button.click());
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(el.textContent ?? "").not.toContain("Да, разослать");
  });

  it("без блокера кнопка живая и взводится", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
    vi.spyOn(apiClient, "getMe").mockResolvedValue(ME);
    vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([]);
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([
      row({ collection: collection({ collectUrl: "https://sber.ru/x" }) }),
    ]);
    vi.spyOn(apiClient, "getCollectionPreview").mockResolvedValue(preview({ collectUrl: "https://sber.ru/x" }));

    const el = await mount();
    await openCard(el);

    const button = sendButton(el);
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    await settle();
    expect(el.textContent ?? "").toContain("Да, разослать");
  });
});
