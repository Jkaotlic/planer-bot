// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Shift } from "../api/client";
import { DayTeamList } from "./DayTeamList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IGOR: Shift = {
  id: 2, date: "2026-09-10", endDate: null, start: "09:00", end: "18:00",
  category: "shift", title: null, location: null, templateId: 2,
  employeeId: 2, employeeName: "Игорь", unrecognisedCode: null,
} as Shift;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(shifts: Shift[]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(DayTeamList, { shifts })));
  });
  return host;
}

describe("DayTeamList", () => {
  it("строка — имя · время · вид", async () => {
    const el = await mount([IGOR]);
    expect(el.textContent).toContain("Игорь · 09:00–18:00 · Смена");
  });

  it("дежурство называет своей подписью, а не общей категорией", async () => {
    const duty: Shift = { ...IGOR, id: 3, category: "duty", title: "Дежурство · Поклонка" };
    const el = await mount([duty]);
    expect(el.textContent).toContain("Дежурство · Поклонка");
  });

  it("несколько строк — каждая своя", async () => {
    const marat: Shift = { ...IGOR, id: 4, employeeId: 4, employeeName: "Марк", start: "07:00", end: "16:00" };
    const el = await mount([IGOR, marat]);
    expect(el.textContent).toContain("Игорь · 09:00–18:00");
    expect(el.textContent).toContain("Марк · 07:00–16:00");
  });
});
