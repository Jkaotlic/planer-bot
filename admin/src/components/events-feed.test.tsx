// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { EventsFeed } from "./EventsFeed";
import type { FeedEvent } from "../api/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function renderFeed(events: readonly FeedEvent[], onOpenJournal?: () => void) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(EventsFeed, { events, onOpenJournal })));
  return host;
}

const event = (over: Partial<FeedEvent>): FeedEvent => ({
  id: 1, type: "entry_created", actorName: "Игорь Петров", timeLabel: "5 минут назад", payload: {}, ...over,
});

describe("лента «События»", () => {
  // Ровно та жалоба, ради которой задача: в ленте стояло «Игорь —
  // событие: employee_observer_changed», то есть сырой тип из базы. Имя здесь
  // вымышленное: в жалобе стояло настоящее, и сторож `no-real-names.test.ts`
  // поймал его в этом самом файле.
  it("называет событие словами, а не типом из базы", async () => {
    const text = (await renderFeed([
      event({ type: "employee_observer_changed", payload: { displayName: "Марк Волков", after: false } }),
    ])).textContent ?? "";
    expect(text).toContain("Роль «Наблюдатель» снята");
    expect(text).toContain("Марк Волков");
    expect(text).not.toContain("employee_observer_changed");
  });

  it("показывает, кто это сделал, и когда", async () => {
    const text = (await renderFeed([
      event({ type: "announcement_sent", actorName: "Игорь Петров", timeLabel: "14 минут назад",
              payload: { text: "Завтра планёрка", audience: "all", delivered: 12, intended: 13 } }),
    ])).textContent ?? "";
    expect(text).toContain("Разослано объявление");
    expect(text).toContain("Игорь Петров");
    expect(text).toContain("14 минут назад");
  });

  // Событие бота актора не имеет, и «Кто-то» вместо него — это догадка, которая
  // читается как «человек, чьё имя не загрузилось». В журнале рядом стоит «система».
  it("бесхозное событие подписывает «система», а не «Кто-то»", async () => {
    const text = (await renderFeed([
      event({ type: "reminders_dispatched", actorName: null, payload: { forDate: "2026-08-22", sent: 12, considered: 13 } }),
    ])).textContent ?? "";
    expect(text).toContain("система");
    expect(text).not.toContain("Кто-то");
  });

  // Тридцать строк без фильтров — это дайджест, а не журнал, и он не должен
  // притворяться полным: за остальным ведёт ссылка.
  it("уводит в «Журнал» за полным списком", async () => {
    let opened = 0;
    const node = await renderFeed([event({})], () => { opened += 1; });
    const link = node.querySelector<HTMLButtonElement>(".feed-more");
    expect(link?.textContent).toContain("Все события");
    await act(async () => link!.click());
    expect(opened).toBe(1);
  });

  it("пустую ленту не выдаёт за отказ загрузки", async () => {
    const text = (await renderFeed([])).textContent ?? "";
    expect(text).toContain("Пока ничего не происходило");
  });
});
