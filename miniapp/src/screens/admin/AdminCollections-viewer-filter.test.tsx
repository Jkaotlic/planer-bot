// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Employee, type Me } from "../../api/client";
import { AdminCollections } from "./AdminCollections";

/**
 * Себе сбор не заводят: «Кому» на форме «+ Новый сбор» обязан выкидывать
 * смотрящего (`viewerId`) из списка, даже если он активный работник. До
 * замены `Select` на `PersonPicker` (Task 12) этот фильтр стоял прямо в
 * JSX и своего теста не имел — мутация его в брифе задачи и подняла.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME: Me = {
  id: 9, displayName: "Админ Админов", address: "Админ", preferredName: null,
  isAdmin: true, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, canAnnounce: true,
};

function employee(overrides: Partial<Employee>): Employee {
  return {
    id: 1, displayName: "Аня", isAdmin: false, isActive: true, telegramUserId: null,
    birthDate: null, address: "Аня", preferredName: null,
    excludedFromAssignment: false, excludedFromSwaps: false,
    isObserver: false, selfScheduleEnabled: false,
    ...overrides,
  };
}

const EMPLOYEES: Employee[] = [
  // Смотрящий — админ, тоже числится работником, себе сбор заводить не должен.
  employee({ id: 9, displayName: "Админ Админов" }),
  employee({ id: 2, displayName: "Игорь Коллега" }),
  employee({ id: 3, displayName: "Марк Коллега", isActive: false }),
];

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
  vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
  vi.spyOn(apiClient, "getCollections").mockResolvedValue([]);
  vi.spyOn(apiClient, "getMe").mockResolvedValue(ME);
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue(EMPLOYEES);

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminCollections)));
  });
  await settle();
  return host;
}

function openNewCollectionForm(el: HTMLElement) {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "+ Новый сбор");
  if (!found) throw new Error("не нашёл кнопку «+ Новый сбор»");
  return act(async () => found.click());
}

function personPickerRowNames(el: HTMLElement): string[] {
  return [...el.querySelectorAll<HTMLElement>(".person-picker-row")].map((r) => (r.textContent ?? "").trim());
}

describe("«Кому» на «Сборах» не предлагает завести сбор себе", () => {
  it("смотрящего в списке нет, активный коллега на месте, уволенный — тоже нет", async () => {
    const el = await mount();
    await openNewCollectionForm(el);

    const names = personPickerRowNames(el);
    expect(names.some((n) => n.includes("Админ Админов"))).toBe(false);
    expect(names.some((n) => n.includes("Игорь Коллега"))).toBe(true);
    expect(names.some((n) => n.includes("Марк Коллега"))).toBe(false);
  });
});
