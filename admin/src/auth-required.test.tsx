// @vitest-environment jsdom
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthRequiredError, apiClient, type Collection, type UpcomingBirthday } from "./api/client";
import { AuthRequiredProvider } from "./auth-required";
import { AnnounceScreen } from "./screens/AnnounceScreen";
import { ChecklistScreen } from "./screens/ChecklistScreen";
import { CollectionsScreen } from "./screens/CollectionsScreen";
import { GroupsScreen } from "./screens/GroupsScreen";
import { JournalScreen } from "./screens/JournalScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { ShiftKindsScreen } from "./screens/ShiftKindsScreen";
import { waitFor } from "./test-wait";

/**
 * Истёкшая сессия посреди экрана ведёт на вход, а не оставляет «Загрузка…» навсегда:
 * каждый экран, который раньше писал `if (err instanceof AuthRequiredError) return;`,
 * обязан вызвать `onAuthRequired` из контекста. По одному тесту на каждое такое место.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

const expired = () => new AuthRequiredError("Сессия истекла — войди заново");

async function mountInApp(screen: ComponentType<never>, props: object = {}) {
  const onAuth = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(createElement(AuthRequiredProvider, { value: onAuth }, createElement(screen as ComponentType<object>, props))),
  );
  return { el: host, onAuth };
}

const button = (el: HTMLElement, text: string) => {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);
  if (!found) throw new Error(`нет кнопки «${text}»`);
  return found;
};

/** Ждём, пока вход запросят, и проверяем, что красной плашки «Сессия истекла» нет. */
async function expectLogin(el: HTMLElement, onAuth: ReturnType<typeof vi.fn>) {
  await waitFor(() => expect(onAuth).toHaveBeenCalled(), 2000);
  expect(el.textContent).not.toContain("Сессия истекла");
}

describe("консоль: истёкшая сессия на экранах — вход, а не вечная загрузка", () => {
  it("«Анонсы»: загрузка получателей", async () => {
    vi.spyOn(apiClient, "getAnnouncementRecipients").mockRejectedValue(expired());
    const { el, onAuth } = await mountInApp(AnnounceScreen);
    await expectLogin(el, onAuth);
  });

  it("«Чек-лист»: загрузка", async () => {
    vi.spyOn(apiClient, "getChecklists").mockRejectedValue(expired());
    vi.spyOn(apiClient, "getChecklistDay").mockResolvedValue({} as never);
    const { el, onAuth } = await mountInApp(ChecklistScreen, { templates: [] });
    await expectLogin(el, onAuth);
  });

  it("«Группы»: загрузка", async () => {
    vi.spyOn(apiClient, "getRecipientGroups").mockRejectedValue(expired());
    const { el, onAuth } = await mountInApp(GroupsScreen, { employees: [] });
    await expectLogin(el, onAuth);
  });

  it("«Группы»: действие (создание) тоже", async () => {
    vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue([]);
    vi.spyOn(apiClient, "createRecipientGroup").mockRejectedValue(expired());
    const { el, onAuth } = await mountInApp(GroupsScreen, { employees: [{ id: 1, displayName: "Аня", isActive: true }] });
    await waitFor(() => expect(button(el, "+ Новая группа")).toBeTruthy(), 2000);
    await act(async () => button(el, "+ Новая группа").click());
    const name = el.querySelector<HTMLInputElement>('input[aria-label="Название группы"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Кухня");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button(el, "Сохранить").click());
    await expectLogin(el, onAuth);
  });

  it("«Чек-лист»: действие (создание) тоже", async () => {
    vi.spyOn(apiClient, "getChecklists").mockResolvedValue([]);
    vi.spyOn(apiClient, "getChecklistDay").mockResolvedValue({} as never);
    vi.spyOn(apiClient, "createChecklist").mockRejectedValue(expired());
    const { el, onAuth } = await mountInApp(ChecklistScreen, { templates: [] });
    const field = await vi.waitFor(() => el.querySelector<HTMLInputElement>('input[aria-label="Название чек-листа"]')!);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Утро");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button(el, "Новый чек-лист").click());
    await expectLogin(el, onAuth);
  });

  it("«Журнал»: отчёт по дежурствам", async () => {
    vi.spyOn(apiClient, "getShiftCounts").mockRejectedValue(expired());
    const { el, onAuth } = await mountInApp(JournalScreen);
    await expectLogin(el, onAuth);
  });

  it("«Журнал»: загрузка ленты", async () => {
    vi.spyOn(apiClient, "getJournal").mockRejectedValue(expired());
    vi.spyOn(apiClient, "getShiftCounts").mockReturnValue(new Promise(() => {}));
    vi.spyOn(apiClient, "getEmployees").mockResolvedValue([]);
    const { el, onAuth } = await mountInApp(JournalScreen);
    await act(async () => button(el, "Кто что менял").click());
    await expectLogin(el, onAuth);
  });

  it("«Виды смен»: загрузка", async () => {
    vi.spyOn(apiClient, "getChecklists").mockResolvedValue([]);
    vi.spyOn(apiClient, "getTemplateRoles").mockRejectedValue(expired());
    const { el, onAuth } = await mountInApp(ShiftKindsScreen, { employees: [], onNormSaved: () => {} });
    await expectLogin(el, onAuth);
  });

  it("«Настройки»: загрузка настроек", async () => {
    vi.spyOn(apiClient, "getSettings").mockRejectedValue(expired());
    vi.spyOn(apiClient, "getNoticePrefs").mockResolvedValue({ kinds: [] });
    const { el, onAuth } = await mountInApp(SettingsScreen);
    await expectLogin(el, onAuth);
  });

  it("«Настройки»: загрузка списка уведомлений", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue({ reminderHour: 9, holidays: [] } as never);
    vi.spyOn(apiClient, "getNoticePrefs").mockRejectedValue(expired());
    const { el, onAuth } = await mountInApp(SettingsScreen);
    await expectLogin(el, onAuth);
  });
});

describe("консоль: истёкшая сессия в «Сборах»", () => {
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

  function stubOthers() {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue({ asOf: "2026-09-01", birthdays: [] });
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([]);
    vi.spyOn(apiClient, "getEmployees").mockResolvedValue([]);
    vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue([]);
  }

  it("список дней рождения", async () => {
    stubOthers();
    vi.spyOn(apiClient, "getBirthdays").mockRejectedValue(expired());
    const { el, onAuth } = await mountInApp(CollectionsScreen);
    await expectLogin(el, onAuth);
  });

  it("список сборов", async () => {
    stubOthers();
    vi.spyOn(apiClient, "getCollections").mockRejectedValue(expired());
    const { el, onAuth } = await mountInApp(CollectionsScreen);
    await expectLogin(el, onAuth);
  });

  it("предпросмотр раунда дня рождения", async () => {
    stubOthers();
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue({ asOf: "2026-09-01", birthdays: [BIRTHDAY] });
    vi.spyOn(apiClient, "getBirthdayPreview").mockRejectedValue(expired());
    const { el, onAuth } = await mountInApp(CollectionsScreen);
    await waitFor(() => expect(button(el, "Подготовить сбор")).toBeTruthy());
    await act(async () => button(el, "Подготовить сбор").click());
    await expectLogin(el, onAuth);
  });

  it("предпросмотр обычного сбора", async () => {
    stubOthers();
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([
      { collection: { ...ROUND, id: 1, kind: "custom", title: "Кофемашина" }, personName: null, title: "Кофемашина", status: "pending", active: true },
    ]);
    vi.spyOn(apiClient, "getCollectionPreview").mockRejectedValue(expired());
    const { el, onAuth } = await mountInApp(CollectionsScreen);
    await waitFor(() => expect(button(el, "Открыть")).toBeTruthy());
    await act(async () => button(el, "Открыть").click());
    await expectLogin(el, onAuth);
  });
});
