// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GreetingHero } from "./GreetingHero";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function render(props: Parameters<typeof GreetingHero>[0]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(GreetingHero, props)));
  return host;
}

describe("приветствие: вход в «Сервисы»", () => {
  it("кнопка с подписью «Сервисы» стоит перед шестерёнкой и открывает экран", async () => {
    const onServices = vi.fn();
    const el = await render({ name: "Аня", summary: "…", onSettings: vi.fn(), onServices });
    const buttons = [...el.querySelectorAll("button")];
    expect(buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim())).toEqual(["🧰Сервисы", "Настройки"]);
    await act(async () => buttons[0]!.click());
    expect(onServices).toHaveBeenCalledTimes(1);
  });

  // Подпись, а не одна иконка (спека п. 1): у кнопки видимый текст, а не aria-label.
  it("подпись видна текстом, эмодзи скрыт от читалки", async () => {
    const el = await render({ name: "Аня", summary: "…", onServices: vi.fn() });
    const button = el.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBeNull();
    expect(button.querySelector('[aria-hidden="true"]')!.textContent).toBe("🧰");
    expect(button.textContent).toContain("Сервисы");
  });

  it("без обработчика кнопки нет", async () => {
    const el = await render({ name: "Аня", summary: "…" });
    expect(el.querySelector("button")).toBeNull();
  });
});
