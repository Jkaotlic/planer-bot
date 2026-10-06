// @vitest-environment jsdom
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarFrom } from "@planer/shared";
import { AuthRequiredError, apiClient, type Employee, type Template } from "./api/client";
import { AuthRequiredProvider } from "./auth-required";
import { AddEntryPanel } from "./components/AddEntryPanel";
import { FillWeekPanel } from "./components/FillWeekPanel";
import { RecipientGroupField } from "./components/RecipientGroupField";
import { BugsScreen } from "./screens/BugsScreen";
import { CollectionsScreen } from "./screens/CollectionsScreen";
import { EmployeesScreen } from "./screens/EmployeesScreen";
import { SickApprovalsScreen } from "./screens/SickApprovalsScreen";
import { WeekendAdminScreen } from "./screens/WeekendAdminScreen";
import { waitFor } from "./test-wait";

/**
 * Продолжение `auth-required.test.tsx`: экраны и панели, которые показывали
 * `AuthRequiredError` текстом ошибки («Сессия истекла») вместо входа. По одному
 * тесту на каждый — путь, где раньше уходил текст.
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

async function mountInApp(component: ComponentType<never>, props: object = {}) {
  const onAuth = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(createElement(AuthRequiredProvider, { value: onAuth }, createElement(component as ComponentType<object>, props))),
  );
  return { el: host, onAuth };
}

const button = (el: HTMLElement, text: string) => {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);
  if (!found) throw new Error(`нет кнопки «${text}»`);
  return found;
};

async function typeInto(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function expectLogin(el: HTMLElement, onAuth: ReturnType<typeof vi.fn>) {
  await waitFor(() => expect(onAuth).toHaveBeenCalled(), 2000);
  expect(el.textContent).not.toContain("Сессия истекла");
}

const person = (id: number, displayName: string): Employee => ({
  id, displayName, isAdmin: false, isActive: true, telegramUserId: 10 + id,
  birthDate: null, preferredName: null, address: displayName,
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, remindersEnabled: true,
});

const DAY: Template = {
  sortOrder: 1, id: 2, name: "День", accent: "blue", start: "09:00", end: "18:00",
  fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: false, category: "shift", location: null,
};

describe("консоль: истёкшая сессия на остальных экранах и панелях — вход", () => {
  it("«Баги»: загрузка", async () => {
    vi.spyOn(apiClient, "getBugReports").mockRejectedValue(expired());
    const { el, onAuth } = await mountInApp(BugsScreen);
    await expectLogin(el, onAuth);
  });

  it("«На подтверждение»: загрузка", async () => {
    vi.spyOn(apiClient, "getSickApprovals").mockRejectedValue(expired());
    const { el, onAuth } = await mountInApp(SickApprovalsScreen);
    await expectLogin(el, onAuth);
  });

  it("«Выходные»: загрузка биржи", async () => {
    vi.spyOn(apiClient, "getWeekendSlots").mockRejectedValue(expired());
    vi.spyOn(apiClient, "getPayroll").mockReturnValue(new Promise(() => {}));
    const { el, onAuth } = await mountInApp(WeekendAdminScreen);
    await expectLogin(el, onAuth);
  });

  it("«Работники»: создание работника", async () => {
    vi.spyOn(apiClient, "createEmployee").mockRejectedValue(expired());
    const { el, onAuth } = await mountInApp(EmployeesScreen, {
      employees: [person(1, "Аня")], onChanged: async () => {}, onRestrictionsSaved: () => {}, onObserverSaved: () => {},
    });
    await act(async () => button(el, "＋ Добавить работника").click());
    await typeInto(el.querySelector<HTMLInputElement>(".panel input")!, "Марк");
    await act(async () => button(el, "Создать").click());
    await expectLogin(el, onAuth);
  });

  it("панель записи: сохранение", async () => {
    const { el, onAuth } = await mountInApp(AddEntryPanel, {
      employees: [person(1, "Аня")], templates: [DAY], initialEmployeeId: 1, initialDate: "2026-06-08",
      calendar: calendarFrom([]), onCancel: () => {}, onSave: async () => { throw expired(); },
    });
    await act(async () => button(el, "Сохранить").click());
    await expectLogin(el, onAuth);
  });

  it("«Заполнить неделю»: отправка", async () => {
    vi.spyOn(apiClient, "createEntries").mockRejectedValue(expired());
    const { el, onAuth } = await mountInApp(FillWeekPanel, {
      employees: [person(1, "Иванова Анна")], templates: [DAY],
      weekDates: ["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"],
      calendar: calendarFrom([]), onCancel: () => {}, onFilled: async () => {},
    });
    await act(async () => [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Иванова Анна"))!.click());
    const monday = el.querySelector<HTMLSelectElement>('select[aria-label="Пн, 8 июня"]')!;
    await act(async () => {
      monday.value = "p:2";
      monday.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Заполнить (1)"))!.click());
    await expectLogin(el, onAuth);
  });

  it("выбор группы адресатов: загрузка групп", async () => {
    vi.spyOn(apiClient, "getRecipientGroups").mockRejectedValue(expired());
    const { onAuth } = await mountInApp(RecipientGroupField, { value: null, onChange: () => {}, sent: false });
    await waitFor(() => expect(onAuth).toHaveBeenCalled(), 2000);
  });

  it("«Сборы»: создание сбора", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue({ asOf: "2026-09-01", birthdays: [] });
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([]);
    vi.spyOn(apiClient, "getEmployees").mockResolvedValue([]);
    vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue([]);
    vi.spyOn(apiClient, "createCollection").mockRejectedValue(expired());
    const { el, onAuth } = await mountInApp(CollectionsScreen);
    await waitFor(() => expect(el.querySelector('input[aria-label="Повод"]')).not.toBeNull(), 2000);
    await typeInto(el.querySelector<HTMLInputElement>('input[aria-label="Повод"]')!, "Кофемашина");
    await act(async () => button(el, "Создать").click());
    await expectLogin(el, onAuth);
  });
});
