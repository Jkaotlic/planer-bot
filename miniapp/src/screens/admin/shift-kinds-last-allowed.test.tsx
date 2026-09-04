// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Employee, type TemplateRolesView } from "../../api/client";
import { AdminShiftKinds } from "./AdminShiftKinds";

/**
 * Снять последнюю галочку «допущен» нельзя — и человек обязан узнать почему.
 *
 * Пустой список допущенных означает «могут все», то есть снятие последней
 * галочки дало бы ровно обратное задуманному: админ убирает всех, а вид смены
 * открывается всем. Правило живёт в `shared/kind-roles`, а этот тест про то,
 * что экран не проглатывает отказ молча.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IGOR = 2;

const person = (id: number, displayName: string): Employee => ({
  id, displayName, isAdmin: false, isActive: true, telegramUserId: 10 + id,
  birthDate: null, preferredName: null, address: displayName.split(" ")[0]!,
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, remindersEnabled: true,
});

const EMPLOYEES: Employee[] = [person(1, "Аня Смирнова"), person(IGOR, "Игорь Петров")];

const NIGHT: TemplateRolesView = {
  templateId: 7, name: "Ночь", category: "shift", accent: "blue", checklistIds: [], sendReminder: false, reminderText: null,
  coverage: [0, 0, 0, 0, 0, 0, 0],
  pool: [IGOR], preference: {},
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
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(AppRoot, null, createElement(AdminShiftKinds, { employees: EMPLOYEES, onClose: () => {} })),
    );
  });
  await settle();
  return host;
}

describe("последний допущенный", () => {
  it("не снимается, и экран объясняет почему", async () => {
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([NIGHT]);
    const save = vi.spyOn(apiClient, "saveTemplateRoles").mockResolvedValue(undefined);

    const el = await mount();
    const igor = [...el.querySelectorAll("button[aria-expanded]")].find(
      (b) => (b.textContent ?? "").includes("Игорь"),
    ) as HTMLButtonElement;
    await act(async () => igor.click());
    await settle();

    const box = el.querySelector('input[aria-label="Игорь Петров: допущен к «Ночь»"]') as HTMLInputElement;
    expect(box.checked).toBe(true);
    await act(async () => box.click());
    await settle();

    expect(save).not.toHaveBeenCalled();
    expect(el.textContent ?? "").toContain("последнего допущенного снять нельзя");
    // Галочка осталась стоять: отказ — это не «сохранилось наполовину».
    expect((el.querySelector('input[aria-label="Игорь Петров: допущен к «Ночь»"]') as HTMLInputElement).checked).toBe(true);
  });

  it("предпоследнего снять можно", async () => {
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([{ ...NIGHT, pool: [1, IGOR] }]);
    const save = vi.spyOn(apiClient, "saveTemplateRoles").mockResolvedValue(undefined);

    const el = await mount();
    const igor = [...el.querySelectorAll("button[aria-expanded]")].find(
      (b) => (b.textContent ?? "").includes("Игорь"),
    ) as HTMLButtonElement;
    await act(async () => igor.click());
    await settle();

    const box = el.querySelector('input[aria-label="Игорь Петров: допущен к «Ночь»"]') as HTMLInputElement;
    await act(async () => box.click());
    await settle();

    expect(save).toHaveBeenCalledWith(7, [1], {});
  });
});
