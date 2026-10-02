// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import {
  apiClient, type Collection, type CollectionPreview, type CollectionRow, type Me, type UpcomingBirthday,
} from "../../api/client";
import { AdminCollections } from "./AdminCollections";

/**
 * Открытый сбор — несколько карточек (форма, рассылка, отметки, закрытие), и
 * отказ действия обязан появиться в той карточке, чью кнопку нажали. Раньше он
 * рисовался только под «Сохранить»: провалившееся «Да, разослать» читалось как
 * отказ сохранения, а «Удалить сбор» — как будто сообщение относится к форме.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME: Me = {
  id: 9, displayName: "Аня Смирнова", address: "Аня", preferredName: null,
  isAdmin: true, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, startTab: null, canAnnounce: true,
};

const COLLECTION: Collection = {
  id: 1, kind: "custom", employeeId: null, year: null, celebratedOn: null,
  title: "Кофемашина", eventDate: null, deadline: null, amountPerPerson: null, totalGoal: null,
  collectUrl: "https://example.com/pay", messageText: null, closedAt: null,
  scheduledSendOn: null, scheduleNotifiedAt: null, autoSendOn: null, autoSentAt: null,
  sentAt: null, sentCount: 0, sendCount: 0, recipientGroupId: null, createdAt: "2026-08-01T10:00:00Z",
};
const ROW: CollectionRow = { collection: COLLECTION, personName: null, title: "Кофемашина", status: "ready", active: true };

const PREVIEW: CollectionPreview = {
  id: 1, kind: "custom", title: "Кофемашина", personName: null, employeeId: null,
  collectUrl: "https://example.com/pay", message: "текст сбора",
  recipients: [{ employeeId: 2, displayName: "Игорь" }],
  recipientGroupName: null, blocker: null, sendCount: 0, lastSentAt: null,
};

const BIRTHDAY: UpcomingBirthday = {
  employeeId: 6, displayName: "Аня", birthDate: "09-07", birthDateLabel: "7 сентября",
  celebratedOn: "2099-09-07", daysUntil: 6,
  campaign: { ...COLLECTION, id: 4, kind: "birthday", employeeId: 6, title: "День рождения" },
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
      await new Promise((resolve) => setTimeout(resolve, 12));
    });
  }
}

async function mount(birthdays: UpcomingBirthday[] = []) {
  vi.spyOn(apiClient, "getBirthdays").mockResolvedValue(birthdays);
  vi.spyOn(apiClient, "getCollections").mockResolvedValue(birthdays.length ? [] : [ROW]);
  vi.spyOn(apiClient, "getMe").mockResolvedValue(ME);
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([]);
  vi.spyOn(apiClient, "getCollectionPreview").mockResolvedValue(PREVIEW);
  vi.spyOn(apiClient, "getBirthdayPreview").mockResolvedValue({ ...PREVIEW, id: 77, kind: "birthday", personName: "Аня" });
  vi.spyOn(apiClient, "getCollectionPayments").mockResolvedValue({ rows: [], paidCount: 0, total: 0 });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminCollections, { today: "2026-01-01" })));
  });
  await settle();
  return host;
}

/** Подпись кнопки рассылки несёт число получателей, поэтому её ищем по началу. */
const button = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll("button")].find((b) => {
    const text = (b.textContent ?? "").trim();
    return label === "Разослать" ? text.startsWith(label) : text === label;
  }) as HTMLButtonElement;
const card = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement;

async function click(el: HTMLElement, label: string) {
  const b = button(el, label);
  if (!b) throw new Error(`нет кнопки «${label}»`);
  await act(async () => b.click());
  await settle(4);
}

/** Узел с текстом отказа и карточка, в которой он оказался. */
function errorNode(el: HTMLElement, message: string): HTMLElement | undefined {
  return [...el.querySelectorAll<HTMLElement>("div")].find(
    (n) => n.children.length === 0 && (n.textContent ?? "") === message,
  );
}

function expectOnlyIn(el: HTMLElement, message: string, here: string, elsewhere: string[]) {
  const node = errorNode(el, message);
  expect(node, "сообщение не показано").toBeTruthy();
  expect(card(el, here).contains(node!), `не в карточке ${here}`).toBe(true);
  for (const other of elsewhere) {
    expect(card(el, other).contains(node!), `попало в ${other}`).toBe(false);
  }
  // Ровно один показ: второй узел с тем же текстом в соседней карточке — тоже ошибка.
  expect([...el.querySelectorAll("div")].filter((n) => n.children.length === 0 && n.textContent === message)).toHaveLength(1);
}

describe("отказ действия раскрытого сбора — в карточке нажатой кнопки", () => {
  it("«Да, разослать» — в карточке рассылки, не под «Сохранить»", async () => {
    vi.spyOn(apiClient, "sendCollection").mockRejectedValue(new Error("Рассылка отклонена"));
    const el = await mount();
    await click(el, "Открыть");
    await click(el, "Разослать");
    await click(el, "Да, разослать");
    expectOnlyIn(el, "Рассылка отклонена", "collection-send-card", ["collection-form-card", "collection-close-card"]);
  });

  it("«Собрали, закрыть» — в карточке закрытия", async () => {
    vi.spyOn(apiClient, "setCollectionClosed").mockRejectedValue(new Error("Закрыть не вышло"));
    const el = await mount();
    await click(el, "Открыть");
    await click(el, "Собрали, закрыть");
    expectOnlyIn(el, "Закрыть не вышло", "collection-close-card", ["collection-form-card", "collection-send-card"]);
  });

  it("«Удалить сбор» — в карточке закрытия и удаления", async () => {
    vi.spyOn(apiClient, "deleteCollection").mockRejectedValue(new Error("Удалить не вышло"));
    const el = await mount();
    await click(el, "Открыть");
    await click(el, "Удалить сбор");
    expectOnlyIn(el, "Удалить не вышло", "collection-close-card", ["collection-form-card", "collection-send-card"]);
  });

  it("«Сохранить» — в карточке формы", async () => {
    vi.spyOn(apiClient, "saveCollection").mockRejectedValue(new Error("Сохранить не вышло"));
    const el = await mount();
    await click(el, "Открыть");
    await click(el, "Сохранить");
    expectOnlyIn(el, "Сохранить не вышло", "collection-form-card", ["collection-send-card", "collection-close-card"]);
  });
});

describe("раунд дня рождения: то же правило", () => {
  it("«Да, разослать» — в карточке рассылки", async () => {
    vi.spyOn(apiClient, "sendCollection").mockRejectedValue(new Error("Рассылка отклонена"));
    const el = await mount([BIRTHDAY]);
    await click(el, "Подготовить сбор");
    await click(el, "Разослать");
    await click(el, "Да, разослать");
    expectOnlyIn(el, "Рассылка отклонена", "birthday-send-card", ["birthday-form-card"]);
  });

  it("«Сохранить» — в карточке формы", async () => {
    vi.spyOn(apiClient, "saveBirthdayRound").mockRejectedValue(new Error("Сохранить не вышло"));
    const el = await mount([BIRTHDAY]);
    await click(el, "Подготовить сбор");
    await click(el, "Сохранить");
    expectOnlyIn(el, "Сохранить не вышло", "birthday-form-card", ["birthday-send-card"]);
  });
});
