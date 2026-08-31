// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Collection, type CollectionPreview, type CollectionRow } from "./api/client";
import { App } from "./App";

/**
 * Тот же поимённый список, что во вкладке админа в мини-аппе, — и он обязан
 * считать так же. Счёт приходит с сервера, консоль не считает ничего сама:
 * два независимых счёта разъезжаются на третьем месяце.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COLLECTION: Collection = {
  id: 3, kind: "custom", employeeId: null, year: null, celebratedOn: null,
  title: "Кофемашина", eventDate: null, deadline: null, amountPerPerson: 500, totalGoal: null,
  collectUrl: "https://example.test/c/1", messageText: null, closedAt: null,
  scheduledSendOn: null, scheduleNotifiedAt: null, autoSendOn: null, autoSentAt: null, sentAt: "2026-08-20T10:00:00Z", sentCount: 3, sendCount: 1,
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

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 20) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

function byText(el: HTMLElement, selector: string, text: string): HTMLElement {
  const found = [...el.querySelectorAll(selector)].find((node) => (node.textContent ?? "").trim() === text);
  if (!found) throw new Error(`не нашёл ${selector} с подписью «${text}»`);
  return found as HTMLElement;
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
  if (!found) throw new Error(`не нашёл кнопку с текстом «${text}»`);
  return found;
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
  await settle();
}

async function open(payments = PAYMENTS) {
  vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
  vi.spyOn(apiClient, "getCollections").mockResolvedValue([ROW]);
  vi.spyOn(apiClient, "getCollectionPreview").mockResolvedValue(PREVIEW);
  vi.spyOn(apiClient, "getCollectionPayments").mockResolvedValue(payments);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(App)); });
  await settle();
  await click(byText(host, ".sidebar-nav-item", "Сборы"));
  await click(buttonByText(host, "Открыть"));
  return host;
}

describe("список отметок в консоли", () => {
  it("показывает, кто отметился, а кто нет", async () => {
    const el = await open();
    const text = el.textContent ?? "";
    expect(text).toContain("Отметились 1 из 3");
    expect(text).toContain("Игорь");
    expect(text).toContain("Марк");
  });

  it("кнопка дожима называет число тех, кому уйдёт", async () => {
    const el = await open();
    expect(buttonByText(el, "Напомнить не сдавшим (2)")).toBeTruthy();
  });

  it("когда отметились все, дожимать некого — кнопка выключена", async () => {
    const el = await open({ rows: PAYMENTS.rows.map((r) => ({ ...r, paid: true })), paidCount: 3, total: 3 });
    expect(buttonByText(el, "Напомнить не сдавшим").disabled).toBe(true);
  });

  it("тап админа по чужой строке ставит галочку", async () => {
    const el = await open();
    const mark = vi.spyOn(apiClient, "setCollectionPaymentFor").mockResolvedValue({
      rows: PAYMENTS.rows.map((r) => (r.employeeId === 2 ? { ...r, paid: true, markedByAdmin: true } : r)),
      paidCount: 2,
      total: 3,
    });

    await click(el.querySelector<HTMLButtonElement>('[data-testid="payment-toggle-2"]')!);

    expect(mark).toHaveBeenCalledWith(3, 2, true);
    expect(el.textContent ?? "").toContain("Отметились 2 из 3");
  });

  it("дожим уходит вторым тапом и говорит, до скольких дошло", async () => {
    const el = await open();
    const remind = vi.spyOn(apiClient, "remindUnpaid").mockResolvedValue({ delivered: 2, intended: 2 });

    await click(buttonByText(el, "Напомнить не сдавшим (2)"));
    await click(buttonByText(el, "Да, напомнить"));

    expect(remind).toHaveBeenCalledWith(3);
    expect(el.textContent ?? "").toContain("дошло до 2 из 2");
  });
});
