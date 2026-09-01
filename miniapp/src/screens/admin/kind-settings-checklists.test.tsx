// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../../api/client";
import { AdminKindSettings } from "./AdminKindSettings";

/**
 * Чек-листы вида смены — зеркало теста консоли.
 *
 * Проверяется не вёрстка, а то, из-за чего 2026-09-01 дежурные остались без
 * инструкции 47 этажа: выбор второго списка не должен снимать первый, а на
 * экране должны быть видны оба.
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
    root!.render(createElement(AppRoot, null, createElement(AdminKindSettings, { onClose: () => {} })));
  });
  await settle();
  return host;
}

/** Вид смены «Дежурство с 07:00» — тот, у которого в моках есть чек-лист. */
async function openDuty(el: HTMLElement) {
  const head = [...el.querySelectorAll("button")]
    .filter((b) => b.getAttribute("aria-expanded") === "false")
    .find((b) => (b.textContent ?? "").includes("Дежурство с 07:00"));
  if (!head) throw new Error("нет вида смены «Дежурство с 07:00»");
  await act(async () => head.click());
  await settle();
}

function checklistButton(el: HTMLElement, name: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === name);
  if (!found) throw new Error(`нет кнопки чек-листа «${name}»`);
  return found as HTMLButtonElement;
}

describe("чек-листы вида смены в мини-аппе", () => {
  it("показывает все списки и отмечает назначенные", async () => {
    const el = await mount();
    await openDuty(el);

    expect(checklistButton(el, "Дежурство с 07:00").getAttribute("aria-pressed")).toBe("true");
    expect(checklistButton(el, "Утро с 08:00").getAttribute("aria-pressed")).toBe("false");
  });

  /** Ровно прод-случай: второй список добавляется, первый остаётся. */
  it("выбор второго списка не снимает первый", async () => {
    const save = vi.spyOn(apiClient, "setTemplateChecklists").mockResolvedValue(undefined);
    const el = await mount();
    await openDuty(el);

    await act(async () => checklistButton(el, "Утро с 08:00").click());
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    const [, ids] = save.mock.calls[0]!;
    expect([...ids].sort()).toEqual([1, 2]);
  });

  it("повторный тап снимает список", async () => {
    const save = vi.spyOn(apiClient, "setTemplateChecklists").mockResolvedValue(undefined);
    const el = await mount();
    await openDuty(el);

    await act(async () => checklistButton(el, "Дежурство с 07:00").click());
    await settle();

    expect(save.mock.calls[0]![1]).toEqual([]);
  });
});
