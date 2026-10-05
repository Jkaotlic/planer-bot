// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Shift } from "../api/client";
import { EntryChip } from "./EntryChip";

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SICK = {
  id: 1, date: "2026-10-06", endDate: null, start: null, end: null, category: "sick_leave",
  title: null, templateId: null, employeeId: 1, location: null, unrecognisedCode: null,
} as unknown as Shift;

async function chipText(entry: Shift): Promise<string> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(AppRoot, null, createElement(EntryChip, { entry, templates: [] }))));
  const text = host.textContent ?? "";
  await act(async () => root.unmount());
  host.remove();
  return text;
}

describe("EntryChip: ждущий ОК больничный", () => {
  it("подпись самого чипа несёт «ждёт ОК» — словами рядом с записью, а не в подсказке", async () => {
    expect(await chipText({ ...SICK, pending: true } as Shift)).toBe("Больничный · ждёт ОК");
  });

  it("подтверждённый — без пометки", async () => {
    expect(await chipText(SICK)).toBe("Больничный");
  });
});
