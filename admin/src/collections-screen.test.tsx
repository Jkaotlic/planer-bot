// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Collection, type CollectionPreview, type CollectionRow } from "./api/client";
import { CollectionsScreen } from "./screens/CollectionsScreen";

/**
 * Экран «Сборы» в консоли: список, порядок и форма нового сбора.
 *
 * Списка сборов в консоли до этой работы не было вообще — здесь он строится
 * с нуля, и проверяется именно то, что легко сделать неправильно: порядок
 * приходит с сервера и не пересортировывается на экране, закрытый читается
 * закрытым, а строка открывает СВОЙ редактор, а не чужой.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  return {
    personName: null,
    title: patch.collection.title ?? "Сбор",
    status: "pending",
    active: true,
    ...patch,
  };
}

function preview(patch: Partial<CollectionPreview> = {}): CollectionPreview {
  return {
    id: 1, kind: "custom", title: "Кофемашина", personName: null, employeeId: null,
    collectUrl: "https://sber.ru/x", message: "текст сбора",
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
    root!.render(createElement(CollectionsScreen));
  });
  await settle();
  return host;
}

function inputByLabel(el: HTMLElement, label: string): HTMLInputElement {
  const found = el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!found) throw new Error(`не нашёл поле «${label}»`);
  return found;
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);
  if (!found) throw new Error(`не нашёл кнопку с подписью «${text}»`);
  return found;
}

async function type(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("CollectionsScreen", () => {
  it("рисует активные выше закрытых и называет закрытый закрытым", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
    vi.spyOn(apiClient, "getEmployees").mockResolvedValue([]);
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([
      row({ collection: collection({ id: 1, title: "Идёт" }), title: "Идёт" }),
      row({
        collection: collection({ id: 2, title: "Закрытый", collectUrl: "https://x", sentCount: 3, sendCount: 1, closedAt: "2026-08-05T10:00:00Z" }),
        title: "Закрытый", status: "sent", active: false,
      }),
    ]);

    const el = await mount();
    const cards = [...el.querySelectorAll<HTMLElement>('[data-testid="collection-card"]')];
    expect(cards).toHaveLength(2);
    // Порядок задан сервером — экран его не пересортировывает.
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("Идёт"),
      expect.stringContaining("Закрытый"),
    ]);
    expect(cards[1]!.textContent).toContain("Закрыт");
    // Закрытый — это не «Разослано»: иначе чип звал бы дожимать то, что уже
    // собрали. Проверяется отдельно, потому что строка и правда разослана.
    expect(cards[1]!.textContent).not.toContain("Разослано");
  });

  it("«Создать» погашена, пока не введён повод", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
    vi.spyOn(apiClient, "getEmployees").mockResolvedValue([]);
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([]);

    const el = await mount();
    const create = buttonByText(el, "Создать");
    expect(create.disabled).toBe(true);

    // Повод из одних пробелов поводом не считается — иначе сбор без названия
    // ушёл бы команде безымянным.
    await type(inputByLabel(el, "Повод"), "   ");
    expect(create.disabled).toBe(true);

    await type(inputByLabel(el, "Повод"), "Кофемашина");
    expect(create.disabled).toBe(false);
  });

  it("строка разворачивает СВОЙ редактор — предпросмотр запрашивается по её id", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
    vi.spyOn(apiClient, "getEmployees").mockResolvedValue([]);
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([
      row({ collection: collection({ id: 11, title: "Первый" }), title: "Первый" }),
      row({ collection: collection({ id: 22, title: "Второй" }), title: "Второй" }),
    ]);
    const load = vi.spyOn(apiClient, "getCollectionPreview").mockResolvedValue(preview({ id: 22, title: "Второй" }));

    const el = await mount();
    const cards = [...el.querySelectorAll<HTMLElement>('[data-testid="collection-card"]')];
    await act(async () => buttonByText(cards[1]!, "Открыть").click());
    await settle();

    expect(load).toHaveBeenCalledWith(22);
    expect(load).not.toHaveBeenCalledWith(11);
  });
});
