// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Collection, type CollectionPreview, type CollectionRow, type Me } from "../../api/client";
import { AdminCollections } from "./AdminCollections";

/**
 * «По сколько» и «Нужно всего» — два соседних числовых поля одной формы, и
 * ошибка «второе пишет в первое» не видна глазу, пока сбор не сохранён и не
 * открыт заново. Проверяем то, что реально уходит на сервер, а не то, что
 * нарисовано.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME: Me = {
  id: 9, displayName: "Аня Смирнова", address: "Аня", preferredName: null,
  isAdmin: true, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, startTab: null, canAnnounce: true,
};

const COLLECTION: Collection = {
  id: 1, kind: "custom", employeeId: null, year: null, celebratedOn: null,
  title: "Кофемашина", eventDate: null, deadline: null, amountPerPerson: 100, totalGoal: null,
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

async function mount() {
  vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
  vi.spyOn(apiClient, "getCollections").mockResolvedValue([ROW]);
  vi.spyOn(apiClient, "getMe").mockResolvedValue(ME);
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([]);
  vi.spyOn(apiClient, "getCollectionPreview").mockResolvedValue(PREVIEW);
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

/** Печать в управляемое поле React: присваивание `value` в обход трекера значения. */
async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const field = (el: HTMLElement, label: string) => el.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
const button = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label) as HTMLButtonElement;

/** Запрос, который не завершается, пока тест сам не отпустит. */
function pending<T>() {
  let release!: (v: T) => void;
  const promise = new Promise<T>((resolve) => { release = resolve; });
  return { promise, release };
}

async function openNewForm(el: HTMLElement) {
  await act(async () => button(el, "+ Новый сбор").click());
  await typeInto(el.querySelector('input[placeholder="Например, Свадьба"]') as HTMLInputElement, "Свадьба");
}

describe("поля сумм в форме нового сбора", () => {
  it("«По сколько» и «Нужно всего» уходят в свои ключи", async () => {
    const create = vi.spyOn(apiClient, "createCollection").mockResolvedValue(undefined as never);
    const el = await mount();
    await openNewForm(el);
    await typeInto(field(el, "По сколько"), "300");
    await typeInto(field(el, "Нужно всего"), "5000");
    await act(async () => button(el, "Создать").click());
    await settle();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      title: "Свадьба", employeeId: null, eventDate: null, deadline: null,
      amountPerPerson: 300, totalGoal: 5000, collectUrl: null, messageText: null, recipientGroupId: null,
    });
  });

  it("пустое поле — null, а не ноль; заполнено только одно — второе null", async () => {
    const create = vi.spyOn(apiClient, "createCollection").mockResolvedValue(undefined as never);
    const el = await mount();
    await openNewForm(el);
    await typeInto(field(el, "Нужно всего"), "5000");
    await act(async () => button(el, "Создать").click());
    await settle();

    expect(create.mock.calls[0]![0]).toMatchObject({ amountPerPerson: null, totalGoal: 5000 });
  });

  it("пока запрос идёт, оба поля погашены", async () => {
    const inflight = pending<never>();
    vi.spyOn(apiClient, "createCollection").mockReturnValue(inflight.promise);
    const el = await mount();
    await openNewForm(el);
    await typeInto(field(el, "По сколько"), "300");
    await typeInto(field(el, "Нужно всего"), "5000");
    expect(field(el, "По сколько").disabled).toBe(false);
    expect(field(el, "Нужно всего").disabled).toBe(false);

    await act(async () => button(el, "Создать").click());
    expect(field(el, "По сколько").disabled).toBe(true);
    expect(field(el, "Нужно всего").disabled).toBe(true);

    await act(async () => inflight.release(undefined as never));
    await settle();
  });
});

describe("поля сумм в редакторе существующего сбора", () => {
  async function openEditor(el: HTMLElement) {
    await act(async () => button(el, "Открыть").click());
    await settle();
  }

  it("«Сохранить» отправляет обе суммы в своих ключах", async () => {
    const save = vi.spyOn(apiClient, "saveCollection").mockResolvedValue(undefined as never);
    const el = await mount();
    await openEditor(el);
    expect(field(el, "По сколько").value).toBe("100");
    await typeInto(field(el, "По сколько"), "300");
    await typeInto(field(el, "Нужно всего"), "5000");
    await act(async () => button(el, "Сохранить").click());
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(1, {
      eventDate: null, deadline: null, amountPerPerson: 300, totalGoal: 5000,
      collectUrl: "https://example.com/pay", messageText: null, recipientGroupId: null,
      title: "Кофемашина", employeeId: null,
    });
  });

  it("очищенное поле «По сколько» уходит как null", async () => {
    const save = vi.spyOn(apiClient, "saveCollection").mockResolvedValue(undefined as never);
    const el = await mount();
    await openEditor(el);
    await typeInto(field(el, "По сколько"), "");
    await typeInto(field(el, "Нужно всего"), "5000");
    await act(async () => button(el, "Сохранить").click());
    await settle();

    expect(save.mock.calls[0]![1]).toMatchObject({ amountPerPerson: null, totalGoal: 5000 });
  });

  it("пока сохраняется, оба поля погашены", async () => {
    const inflight = pending<never>();
    vi.spyOn(apiClient, "saveCollection").mockReturnValue(inflight.promise);
    const el = await mount();
    await openEditor(el);
    expect(field(el, "Нужно всего").disabled).toBe(false);

    await act(async () => button(el, "Сохранить").click());
    expect(field(el, "По сколько").disabled).toBe(true);
    expect(field(el, "Нужно всего").disabled).toBe(true);

    await act(async () => inflight.release(undefined as never));
    await settle();
  });
});
