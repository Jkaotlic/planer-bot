// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiClient, type Collection, type CollectionPreview, type CollectionRow,
  type RecipientGroupView, type UpcomingBirthday,
} from "./api/client";
import { CollectionsScreen } from "./screens/CollectionsScreen";

/**
 * Поле «Рассылаем» у сборов (консоль). Зеркало `miniapp/src/screens/admin/AdminCollections-groups.test.tsx`.
 *
 * Группа решает, кому уйдёт первая рассылка; после неё список зафиксирован, и
 * выбор превращается в текст — иначе админ менял бы то, что уже не изменится.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GROUPS: RecipientGroupView[] = [
  { id: 1, name: "ЧИП 32 этаж", memberIds: [2, 3] },
  { id: 2, name: "ЧИП 5-й этаж", memberIds: [4] },
];

function collection(patch: Partial<Collection> = {}): Collection {
  return {
    id: 1, kind: "custom", employeeId: null, year: null, celebratedOn: null,
    title: "Кофемашина", eventDate: null, deadline: null,
    amountPerPerson: null, totalGoal: null, collectUrl: "https://sber.ru/x", messageText: null,
    closedAt: null, scheduledSendOn: null, scheduleNotifiedAt: null, autoSendOn: null, autoSentAt: null,
    sentAt: null, sentCount: 0, sendCount: 0, recipientGroupId: null, createdAt: "2026-08-01T10:00:00Z",
    ...patch,
  };
}

function row(c: Collection): CollectionRow {
  return { collection: c, personName: null, title: c.title ?? "Сбор", status: "pending", active: true };
}

function preview(patch: Partial<CollectionPreview> = {}): CollectionPreview {
  return {
    id: 1, kind: "custom", title: "Кофемашина", personName: null, employeeId: null,
    collectUrl: "https://sber.ru/x", message: "текст сбора",
    recipients: [{ employeeId: 2, displayName: "Аня" }],
    recipientGroupName: null, blocker: null, sendCount: 0, lastSentAt: null,
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
  for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

async function mount(rows: CollectionRow[], birthdays: UpcomingBirthday[] = []) {
  vi.spyOn(apiClient, "getBirthdays").mockResolvedValue({ asOf: "2026-09-01", birthdays });
  vi.spyOn(apiClient, "getEmployees").mockResolvedValue([]);
  vi.spyOn(apiClient, "getCollections").mockResolvedValue(rows);
  vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue(GROUPS);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(CollectionsScreen)); });
  await settle();
  return host;
}

function button(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
  if (!found) throw new Error(`нет кнопки «${text}»`);
  return found;
}

function openButton(el: HTMLElement): HTMLButtonElement {
  const found = [...el.querySelectorAll<HTMLButtonElement>('[data-testid="collection-card"] button')]
    .find((b) => (b.textContent ?? "").trim() === "Открыть");
  if (!found) throw new Error("нет кнопки «Открыть»");
  return found;
}

// Форма нового сбора в консоли на экране всегда, поэтому у раскрытой карточки
// выбор ищем внутри неё, а не по всему экрану.
function groupSelect(el: HTMLElement, inCard = false): HTMLSelectElement | null {
  const scope = inCard ? ".birthday-card.open " : "";
  return el.querySelector<HTMLSelectElement>(`${scope}select[aria-label="Рассылаем"]`);
}

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("«Рассылаем» у сборов (консоль)", () => {
  it("новый сбор с группой уходит с recipientGroupId", async () => {
    const create = vi.spyOn(apiClient, "createCollection").mockResolvedValue(collection({ id: 5, recipientGroupId: 1 }));
    const el = await mount([]);

    // По умолчанию — вся команда.
    expect(groupSelect(el)!.value).toBe("");
    await type(el.querySelector<HTMLInputElement>('input[aria-label="Повод"]')!, "Кофемашина");
    await choose(groupSelect(el)!, "1");
    await act(async () => button(el, "Создать").click());
    await settle();

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: "Кофемашина", recipientGroupId: 1 }));
  });

  it("по умолчанию новый сбор — вся команда: recipientGroupId null", async () => {
    const create = vi.spyOn(apiClient, "createCollection").mockResolvedValue(collection({ id: 5 }));
    const el = await mount([]);
    await type(el.querySelector<HTMLInputElement>('input[aria-label="Повод"]')!, "Кофемашина");
    await act(async () => button(el, "Создать").click());
    await settle();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ recipientGroupId: null }));
  });

  it("превью называет группу вместо «вся команда»", async () => {
    vi.spyOn(apiClient, "getCollectionPreview").mockResolvedValue(preview({ recipientGroupName: "ЧИП 32 этаж" }));
    const el = await mount([row(collection({ recipientGroupId: 1 }))]);
    await act(async () => openButton(el).click());
    await settle();
    expect(el.textContent).toContain("группа «ЧИП 32 этаж»");
    expect(el.textContent).not.toContain("вся команда:");
    expect(groupSelect(el, true)!.value).toBe("1");
  });

  it("без группы в превью остаётся «вся команда»", async () => {
    vi.spyOn(apiClient, "getCollectionPreview").mockResolvedValue(preview());
    const el = await mount([row(collection())]);
    await act(async () => openButton(el).click());
    await settle();
    expect(el.textContent).toContain("вся команда:");
  });

  it("разосланный сбор — текст «Рассылали: …» без выбора", async () => {
    vi.spyOn(apiClient, "getCollectionPreview").mockResolvedValue(
      preview({ recipientGroupName: "ЧИП 32 этаж", sendCount: 1, lastSentAt: "2026-08-20T10:00:00Z" }),
    );
    vi.spyOn(apiClient, "getCollectionPayments").mockResolvedValue({ paidCount: 0, total: 1, rows: [] } as never);
    const el = await mount([row(collection({ recipientGroupId: 1, sendCount: 1, sentCount: 1 }))]);
    await act(async () => openButton(el).click());
    await settle();
    expect(el.textContent).toContain("Рассылали: ЧИП 32 этаж");
    expect(groupSelect(el, true)).toBeNull();
  });

  it("разосланный сбор всей команде — «Рассылали: вся команда»", async () => {
    vi.spyOn(apiClient, "getCollectionPreview").mockResolvedValue(preview({ sendCount: 1 }));
    vi.spyOn(apiClient, "getCollectionPayments").mockResolvedValue({ paidCount: 0, total: 1, rows: [] } as never);
    const el = await mount([row(collection({ sendCount: 1, sentCount: 1 }))]);
    await act(async () => openButton(el).click());
    await settle();
    expect(el.textContent).toContain("Рассылали: вся команда");
  });

  it("удалённая группа: выбрана и подписана «(удалена)», а не молча «Вся команда»", async () => {
    vi.spyOn(apiClient, "getCollectionPreview").mockResolvedValue(
      preview({ recipientGroupName: "Старая группа", blocker: "Группа «Старая группа» удалена — выбери другую." }),
    );
    const el = await mount([row(collection({ recipientGroupId: 77 }))]);
    await act(async () => openButton(el).click());
    await settle();
    const select = groupSelect(el, true)!;
    expect(select.value).toBe("77");
    expect(select.selectedOptions[0]!.textContent).toBe("Старая группа (удалена)");
  });

  it("правка живой группы сохраняется с recipientGroupId", async () => {
    vi.spyOn(apiClient, "getCollectionPreview").mockResolvedValue(preview());
    const save = vi.spyOn(apiClient, "saveCollection").mockResolvedValue(collection({ recipientGroupId: 2 }));
    const el = await mount([row(collection())]);
    await act(async () => openButton(el).click());
    await settle();
    await choose(groupSelect(el, true)!, "2");
    await act(async () => button(el, "Сохранить").click());
    await settle();
    expect(save).toHaveBeenCalledWith(1, expect.objectContaining({ recipientGroupId: 2 }));
  });

  it("карточка дня рождения сохраняет recipientGroupId", async () => {
    const round = collection({ id: 7, kind: "birthday", employeeId: 1, title: null, year: 2026, celebratedOn: "2026-09-14" });
    const birthday: UpcomingBirthday = {
      employeeId: 1, displayName: "Марк", birthDate: "09-14", birthDateLabel: "14 сентября",
      celebratedOn: "2026-09-14", daysUntil: 13, campaign: round,
    };
    vi.spyOn(apiClient, "getBirthdayPreview").mockResolvedValue(preview({ id: 7, kind: "birthday", personName: "Марк", employeeId: 1 }));
    const save = vi.spyOn(apiClient, "saveBirthdayRound").mockResolvedValue({ ...round, recipientGroupId: 1 });
    const el = await mount([], [birthday]);
    await act(async () => button(el, "Подготовить сбор").click());
    await settle();
    await choose(groupSelect(el, true)!, "1");
    await act(async () => button(el, "Сохранить").click());
    await settle();
    expect(save).toHaveBeenCalledWith(1, expect.objectContaining({ recipientGroupId: 1 }));
  });
});
