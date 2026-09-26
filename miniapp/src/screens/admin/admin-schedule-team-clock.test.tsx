// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../../api/client";
import { AdminScheduleScreen } from "./AdminScheduleScreen";

/**
 * Тот же баг, что и у «Команды» (см. `team-today-clock.test.tsx`): экран
 * расписания вычислял «сегодня» из часов телефона. «Эта неделя» обязана вести
 * к неделе КОМАНДНОЙ даты, которую отдаёт сервер, — 4 октября 2026 (воскресенье
 * прошлой недели), а не к неделе 5 октября (понедельник, куда телефон уже
 * перевалил).
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
  vi.useRealTimers();
});

async function settle(times = 14) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

async function mount(today: string) {
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([]);
  vi.spyOn(apiClient, "getTemplates").mockResolvedValue([]);
  vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([]);
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ shifts: [], employees: [], calendar: [] });

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminScheduleScreen, { today })));
  });
  await settle();
  return host;
}

describe("«Эта неделя» в графике админа — командная дата, а не часы телефона", () => {
  it("открывается сразу на неделе серверной даты", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 5, 0, 30));
    const el = await mount("2026-10-04");

    expect(el.textContent).toContain("28 сентября");
  });

  it("«Эта неделя» уводит на неделю сервера, даже если телефон уже в другой неделе", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 5, 0, 30));
    const el = await mount("2026-10-04");

    const next = el.querySelector('[aria-label="Следующая неделя"]') as HTMLElement;
    await act(async () => next.click());
    await settle();
    expect(el.textContent).not.toContain("28 сентября");

    const back = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Эта неделя"));
    if (!back) throw new Error("нет кнопки «Эта неделя»");
    await act(async () => back.click());
    await settle();

    expect(el.textContent).toContain("28 сентября");
    expect(el.textContent).not.toContain("5–11 октября");
  });
});
