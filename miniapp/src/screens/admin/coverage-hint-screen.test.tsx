// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type TemplateRolesView } from "../../api/client";
import { AdminScheduleScreen } from "./AdminScheduleScreen";

/**
 * Подсказка «чего в дне не хватает» на экране расписания.
 *
 * Молчание по умолчанию — половина смысла: норма у всех видов смен нулевая,
 * пока её не задали, и день, встречающий админа девятью строками «не хватает»,
 * читался бы как поломка, а не как подсказка.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kind = (coverage: number[]): TemplateRolesView => ({
  templateId: 10, name: "Утро", category: "shift", accent: "gold", checklistId: null, sendReminder: false, reminderText: null,
  coverage, pool: [], preference: {},
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 14) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminScheduleScreen)));
  });
  await settle();
  return host;
}

describe("подсказка «чего не хватает» в дне", () => {
  it("молчит, пока норма не задана", async () => {
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([kind([0, 0, 0, 0, 0, 0, 0])]);
    const el = await mount();
    expect(el.textContent ?? "").not.toContain("Не хватает");
  });

  it("называет вид смены, когда норма задана и день пуст", async () => {
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([kind([2, 2, 2, 2, 2, 2, 2])]);
    vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ shifts: [], employees: [] });

    const el = await mount();

    // Норма задана на все семь дней, значит какой бы день ни был выбран по
    // умолчанию — «Утро» в нём не закрыто.
    expect(el.textContent ?? "").toContain("Не хватает: Утро — 2");
  });
});
