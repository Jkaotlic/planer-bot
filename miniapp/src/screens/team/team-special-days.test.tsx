// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../../api/client";
import { TeamScreen } from "../TeamScreen";

/**
 * «Команда → Неделя»: название праздника — текстом над сеткой.
 *
 * В шапке колонки (две цифры шириной) остаётся значок, а название лежало
 * только в `title`, которого на телефоне нет.
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

async function mount(calendar: unknown[]) {
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ shifts: [], employees: [], calendar } as never);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(TeamScreen, { templates: [], initialMode: "week", today: "2026-08-26" })));
  });
  for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  return host;
}

describe("строка праздников над сеткой «Команды»", () => {
  it("есть, с названием и рабочей субботой, и стоит над сеткой", async () => {
    const el = await mount([
      { date: "2026-08-26", kind: "holiday", note: "Праздник", source: "auto" },
      { date: "2026-08-29", kind: "workday", note: null, source: "manual" },
    ]);
    const line = el.querySelector("[data-special-days]")!;
    expect(line.textContent).toBe("🎉 Ср 26 — Праздник · 💼 Сб 29 — рабочая суббота");
    const grid = el.querySelector(".team-week")!;
    expect(line.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("обычная неделя — строки нет", async () => {
    const el = await mount([]);
    expect(el.querySelector(".team-week")).not.toBeNull();
    expect(el.querySelector("[data-special-days]")).toBeNull();
  });
});
