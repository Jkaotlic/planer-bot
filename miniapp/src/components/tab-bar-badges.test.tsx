// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { TabBar } from "./TabBar";

/**
 * «Ждёт тебя»: метка на пункте вкладки, а не только число в заголовке экрана —
 * человек решает, куда зайти, ещё ДО того, как открыл вкладку.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(badges?: Partial<Record<string, number>>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(
        AppRoot,
        null,
        createElement(TabBar, {
          active: "mine",
          onChange: () => {},
          isAdmin: false,
          isObserver: false,
          canAnnounce: false,
          badges,
        } as never),
      ),
    );
  });
  return host;
}

function itemFor(el: HTMLElement, label: string): HTMLElement {
  return [...el.querySelectorAll(".tab-bar-fit button")].find(
    (b) => (b.textContent ?? "").includes(label),
  ) as HTMLElement;
}

describe("TabBar — метки «ждёт тебя»", () => {
  it("рисует .tab-badge с числом внутри пункта, за который отвечает счётчик", async () => {
    const el = await mount({ swaps: 2 });
    const swapsItem = itemFor(el, "Обмены");
    const badge = swapsItem.querySelector(".tab-badge");
    expect(badge).toBeTruthy();
    expect((badge!.textContent ?? "").trim()).toBe("2");
    // Соседний пункт без метки в объекте — своей метки не получает.
    const teamItem = itemFor(el, "Команда");
    expect(teamItem.querySelector(".tab-badge")).toBeNull();
  });

  it("без badges — ни одной метки на баре", async () => {
    const el = await mount(undefined);
    expect(el.querySelectorAll(".tab-badge")).toHaveLength(0);
  });

  it("больше 9 — показывает «9+», а не трёхзначное число", async () => {
    const el = await mount({ swaps: 12 });
    const badge = itemFor(el, "Обмены").querySelector(".tab-badge");
    expect((badge!.textContent ?? "").trim()).toBe("9+");
  });
});
