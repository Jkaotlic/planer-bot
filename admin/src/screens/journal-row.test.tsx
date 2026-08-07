// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { JournalEventRow } from "./JournalScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function renderRow(event: Parameters<typeof JournalEventRow>[0]["event"]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(JournalEventRow, { event })));
  return host.textContent ?? "";
}

const entry = (over: Record<string, unknown>) => ({
  entryId: 9, employeeId: 3, employeeName: "Марк Волков", date: "2026-08-12",
  endDate: null, category: "shift", title: null, start: null, end: null, ...over,
});

describe("строка журнала", () => {
  it("показывает фразу и подробности вместо JSON", async () => {
    const text = await renderRow({
      id: 1,
      type: "entry_updated",
      createdAt: "2026-08-05T14:32:00.000Z",
      actorName: "Игорь Петров",
      payload: { before: entry({}), after: entry({ title: "День", start: "09:00", end: "18:00" }) },
    });
    expect(text).toContain("Изменена смена");
    expect(text).toContain("стало: День 09:00–18:00");
    expect(text).toContain("Игорь Петров");
    // Ровно то, ради чего задача: ключей payload'а на экране больше нет.
    expect(text).not.toContain("entryId");
  });

  it("вместо актора-человека пишет «система», когда его нет", async () => {
    const text = await renderRow({
      id: 2, type: "reminders_dispatched", createdAt: "2026-08-06T20:05:00.000Z",
      actorName: null, payload: { forDate: "2026-08-07", sent: 12, considered: 13 },
    });
    expect(text).toContain("система");
    expect(text).toContain("Разосланы напоминания на завтра");
  });
});
