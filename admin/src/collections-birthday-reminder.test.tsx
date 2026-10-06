// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Collection, type CollectionPreview, type UpcomingBirthday } from "./api/client";
import { CollectionsScreen } from "./screens/CollectionsScreen";

/**
 * «Напомнить мне» у раунда дня рождения (консоль). Сверка морд 2026-10-06: в
 * мини-аппе поле было (`AdminCollections.tsx`, `BirthdayEditor`), в консоли — нет,
 * и админ за ПК не мог попросить бота напомнить ему про сбор. Клиент и сервер
 * дату уже умели (`saveBirthdayRound` → `scheduledSendOn`), не хватало поля.
 *
 * Границы те же, что в мини-аппе: не раньше командного «сегодня» (`asOf`, а не
 * часы браузера) и не позже самого дня рождения — дальше напоминать бессмысленно.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SERVER_TODAY = "2026-09-01";
const BROWSER_TODAY = "2026-09-08";

const ROUND: Collection = {
  id: 7, kind: "birthday", employeeId: 1, year: 2026, celebratedOn: "2026-09-14",
  title: null, eventDate: null, deadline: null, amountPerPerson: null, totalGoal: null,
  collectUrl: null, messageText: null, closedAt: null,
  scheduledSendOn: null, scheduleNotifiedAt: null, autoSendOn: null, autoSentAt: null,
  sentAt: null, sentCount: 0, sendCount: 0, recipientGroupId: null, createdAt: "2026-08-01T10:00:00Z",
};

const BIRTHDAY: UpcomingBirthday = {
  employeeId: 1, displayName: "Марк", birthDate: "09-14", birthDateLabel: "14 сентября",
  celebratedOn: "2026-09-14", daysUntil: 13, campaign: ROUND,
};

const PREVIEW: CollectionPreview = {
  id: 7, kind: "birthday", title: "День рождения", personName: "Марк", employeeId: 1,
  collectUrl: null, message: "текст сбора", recipients: [], recipientGroupName: null,
  blocker: null, sendCount: 0, lastSentAt: null,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function settle(times = 10) {
  for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

async function mountOpen(birthday: UpcomingBirthday) {
  vi.spyOn(apiClient, "getBirthdays").mockResolvedValue({ asOf: SERVER_TODAY, birthdays: [birthday] });
  vi.spyOn(apiClient, "getCollections").mockResolvedValue([]);
  vi.spyOn(apiClient, "getEmployees").mockResolvedValue([]);
  vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue([]);
  vi.spyOn(apiClient, "getBirthdayPreview").mockResolvedValue(PREVIEW);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(CollectionsScreen)); });
  await settle();
  await act(async () => button(host!, "Подготовить сбор").click());
  await settle();
  return host;
}

function button(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);
  if (!found) throw new Error(`нет кнопки «${text}»`);
  return found;
}

function reminderInput(el: HTMLElement): HTMLInputElement | null {
  return el.querySelector<HTMLInputElement>('.birthday-card.open input[aria-label="Дата напоминания о сборе"]');
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("«Напомнить мне» у раунда дня рождения (консоль)", () => {
  it("поле есть, границы — командный today и сам день рождения", async () => {
    vi.setSystemTime(new Date(`${BROWSER_TODAY}T12:00:00Z`));
    const el = await mountOpen(BIRTHDAY);
    const input = reminderInput(el);
    expect(input).not.toBeNull();
    expect(input!.min).toBe(SERVER_TODAY);
    expect(input!.max).toBe("2026-09-14");
    expect(el.textContent).toContain("В этот день бот напишет админам. Команде — по-прежнему только по твоему тапу.");
  });

  it("сохранённая дата подставляется в поле", async () => {
    const el = await mountOpen({ ...BIRTHDAY, campaign: { ...ROUND, scheduledSendOn: "2026-09-10" } });
    expect(reminderInput(el)!.value).toBe("2026-09-10");
  });

  it("«Сохранить» уносит дату в saveBirthdayRound", async () => {
    const save = vi.spyOn(apiClient, "saveBirthdayRound").mockResolvedValue({ ...ROUND, scheduledSendOn: "2026-09-10" });
    const el = await mountOpen(BIRTHDAY);
    await type(reminderInput(el)!, "2026-09-10");
    await act(async () => button(el, "Сохранить").click());
    await settle();
    expect(save).toHaveBeenCalledWith(1, expect.objectContaining({ scheduledSendOn: "2026-09-10" }));
  });

  it("пустое поле снимает напоминание: scheduledSendOn null", async () => {
    const save = vi.spyOn(apiClient, "saveBirthdayRound").mockResolvedValue(ROUND);
    const el = await mountOpen({ ...BIRTHDAY, campaign: { ...ROUND, scheduledSendOn: "2026-09-10" } });
    await type(reminderInput(el)!, "");
    await act(async () => button(el, "Сохранить").click());
    await settle();
    expect(save).toHaveBeenCalledWith(1, expect.objectContaining({ scheduledSendOn: null }));
  });

  it("отказ сервера виден в карточке, рядом с «Сохранить»", async () => {
    vi.spyOn(apiClient, "saveBirthdayRound").mockRejectedValue(new Error("Дата напоминания уже прошла"));
    const el = await mountOpen(BIRTHDAY);
    await type(reminderInput(el)!, "2026-09-10");
    await act(async () => button(el, "Сохранить").click());
    await settle();
    expect(el.querySelector(".birthday-card.open .employees-error")?.textContent).toBe("Дата напоминания уже прошла");
  });
});
