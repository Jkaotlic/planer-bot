// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { JournalEventCard } from "./AdminJournal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function renderCard(event: Parameters<typeof JournalEventCard>[0]["event"]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(AppRoot, null, createElement(JournalEventCard, { event }))));
  return host.textContent ?? "";
}

describe("карточка журнала", () => {
  it("показывает подробности, а не только заголовок", async () => {
    const text = await renderCard({
      id: 1, type: "weekend_interest", createdAt: "2026-08-05T14:32:00.000Z",
      actorName: "Марк Волков",
      payload: { slotId: 4, slot: "сб 8 авг · 10:00–19:00", employeeId: 3, employeeName: "Марк Волков" },
    });
    expect(text).toContain("Отклик на выходную смену");
    // Раньше миниапп не показывал payload вовсе — вот эта строка и есть задача.
    expect(text).toContain("сб 8 авг · 10:00–19:00");
  });
});
