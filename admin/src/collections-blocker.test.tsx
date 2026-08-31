// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Collection, type CollectionPreview, type CollectionRow } from "./api/client";
import { CollectionsScreen } from "./screens/CollectionsScreen";

/**
 * Владелец создал сбор и не нашёл кнопку отправки — живьём, 12 августа.
 *
 * Причина была написана: `previewCollection` возвращает `blocker` («Нет ссылки на
 * сбор — вставь её, прежде чем рассылать»), если `collectUrl` пуст. Но обе консоли
 * на непустой блокер ЗАМЕНЯЛИ кнопку абзацем текста — а человек ищет кнопку, и на
 * её месте читается описание, а не «вот чего не хватает».
 *
 * Теперь кнопка на месте всегда, погашенная, а причина стоит подписью под ней:
 * взгляд находит кнопку и рядом читает, почему она не нажимается.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NO_LINK = "Нет ссылки на сбор — вставь её, прежде чем рассылать.";

function collection(patch: Partial<Collection> = {}): Collection {
  return {
    id: 1, kind: "custom", employeeId: null, year: null, celebratedOn: null,
    title: "Кофемашина", eventDate: null, deadline: null,
    amountPerPerson: null, totalGoal: null, collectUrl: null, messageText: null,
    closedAt: null, scheduledSendOn: null, scheduleNotifiedAt: null, autoSendOn: null, autoSentAt: null,
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

async function settle(times = 15) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(CollectionsScreen));
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
  // Именно по «Открыть»: в строке рядом стоит ещё и «Собрали», и «первая кнопка
  // карточки» с некоторых пор — не та, что раскрывает.
  const open = [...el.querySelectorAll<HTMLButtonElement>('[data-testid="collection-card"] button')]
    .find((b) => (b.textContent ?? "").trim() === "Открыть");
  if (!open) throw new Error("кнопки «Открыть» на карточке нет");
  await act(async () => open.click());
  await settle();
}

describe("блокер рассылки не прячет кнопку (консоль)", () => {
  it("кнопка на месте, погашена, и причина написана рядом", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
    vi.spyOn(apiClient, "getEmployees").mockResolvedValue([]);
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([row({ collection: collection() })]);
    vi.spyOn(apiClient, "getCollectionPreview").mockResolvedValue(preview({ blocker: NO_LINK }));
    const send = vi.spyOn(apiClient, "sendCollection").mockResolvedValue({ delivered: 1, intended: 1, round: 1 });

    const el = await mount();
    await openCard(el);

    const button = sendButton(el);
    expect(button.disabled).toBe(true);
    // Причина осталась на экране — её никто не отнимал, она просто переехала под кнопку.
    expect(el.textContent ?? "").toContain(NO_LINK);

    // Погашенная кнопка ничего не отправляет: ни взвода, ни запроса.
    await act(async () => button.click());
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(el.textContent ?? "").not.toContain("Да, разослать");
  });

  it("без блокера кнопка живая и взводится", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
    vi.spyOn(apiClient, "getEmployees").mockResolvedValue([]);
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
