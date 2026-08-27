// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Collection, type CollectionRow, type CollectionPreview, type Me } from "../../api/client";
import { AdminCollections } from "./AdminCollections";

/**
 * Кто сдал, а кто нет — поимённо и только здесь: команде видна лишь цифра.
 *
 * Числа в подписи кнопки дожима — не украшение: админ должен видеть, скольким
 * человекам он сейчас напишет, ДО того как нажмёт.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COLLECTION: Collection = {
  id: 3, kind: "custom", employeeId: null, year: null, celebratedOn: null,
  title: "Кофемашина", eventDate: null, deadline: null, amountPerPerson: 500, totalGoal: null,
  collectUrl: "https://example.test/c/1", messageText: null, closedAt: null,
  scheduledSendOn: null, scheduleNotifiedAt: null, sentAt: "2026-08-20T10:00:00Z", sentCount: 3, sendCount: 1,
  createdAt: "2026-08-01T10:00:00Z",
};

const ROW: CollectionRow = { collection: COLLECTION, personName: null, title: "Кофемашина", status: "sent", active: true };

const PREVIEW: CollectionPreview = {
  id: COLLECTION.id, kind: "custom", title: "Кофемашина", personName: null, employeeId: null,
  collectUrl: COLLECTION.collectUrl, message: "текст сбора",
  recipients: [
    { employeeId: 1, displayName: "Аня" },
    { employeeId: 2, displayName: "Игорь" },
    { employeeId: 3, displayName: "Марк" },
  ],
  blocker: null, sendCount: 1, lastSentAt: "2026-08-20T10:00:00Z",
};

const PAYMENTS = {
  rows: [
    { employeeId: 1, displayName: "Аня", paid: true, markedByAdmin: false },
    { employeeId: 2, displayName: "Игорь", paid: false, markedByAdmin: false },
    { employeeId: 3, displayName: "Марк", paid: false, markedByAdmin: false },
  ],
  paidCount: 1,
  total: 3,
};

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

async function open(payments = PAYMENTS, row = ROW) {
  vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
  vi.spyOn(apiClient, "getCollections").mockResolvedValue([row]);
  vi.spyOn(apiClient, "getMe").mockResolvedValue(ME);
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([]);
  vi.spyOn(apiClient, "getCollectionPreview").mockResolvedValue(PREVIEW);
  vi.spyOn(apiClient, "getCollectionPayments").mockResolvedValue(payments);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminCollections)));
  });
  await settle();
  await act(async () => button(host!, "Открыть")!.click());
  await settle();
  return host;
}

function button(el: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label);
}

function buttonContaining(el: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
}

describe("список отметок в карточке сбора", () => {
  it("показывает, кто отметился, а кто нет", async () => {
    const el = await open();
    const text = el.textContent ?? "";
    expect(text).toContain("Отметились 1 из 3");
    expect(text).toContain("Игорь");
    expect(text).toContain("Марк");
  });

  it("кнопка дожима называет число тех, кому уйдёт", async () => {
    const el = await open();
    expect(buttonContaining(el, "Напомнить не сдавшим (2)")).toBeTruthy();
  });

  it("когда отметились все, дожимать некого — кнопка выключена", async () => {
    const el = await open({
      rows: PAYMENTS.rows.map((r) => ({ ...r, paid: true })),
      paidCount: 3,
      total: 3,
    });
    expect(buttonContaining(el, "Напомнить не сдавшим")!.disabled).toBe(true);
  });

  it("тап админа по чужой строке ставит галочку", async () => {
    const el = await open();
    const mark = vi.spyOn(apiClient, "setCollectionPaymentFor").mockResolvedValue({
      rows: PAYMENTS.rows.map((r) => (r.employeeId === 2 ? { ...r, paid: true, markedByAdmin: true } : r)),
      paidCount: 2,
      total: 3,
    });

    const toggle = el.querySelector<HTMLButtonElement>('[data-testid="payment-toggle-2"]');
    await act(async () => toggle!.click());
    await settle();

    expect(mark).toHaveBeenCalledWith(3, 2, true);
    expect(el.textContent ?? "").toContain("Отметились 2 из 3");
  });

  it("дожим уходит вторым тапом и говорит, до скольких дошло", async () => {
    const el = await open();
    const remind = vi.spyOn(apiClient, "remindUnpaid").mockResolvedValue({ delivered: 2, intended: 2 });

    await act(async () => buttonContaining(el, "Напомнить не сдавшим (2)")!.click());
    await settle();
    await act(async () => buttonContaining(el, "Да, напомнить")!.click());
    await settle();

    expect(remind).toHaveBeenCalledWith(3);
    expect(el.textContent ?? "").toContain("дошло до 2 из 2");
  });
});
