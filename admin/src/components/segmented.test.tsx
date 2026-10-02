// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Segmented } from "./Segmented";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = [
  { key: "a", label: "Аня" },
  { key: "b", label: "Игорь" },
  { key: "c", label: "Марк" },
] as const;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null; host = null;
});

async function mount(props: { value: "a" | "b" | "c" | null; onChange: (k: "a" | "b" | "c") => void; disabled?: boolean; reselect?: boolean }) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(Segmented<"a" | "b" | "c">, { options: OPTIONS, "aria-label": "Кто", ...props }));
  });
  return host;
}

const items = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>("button.segmented-item")];

describe("Segmented", () => {
  it("рисует три варианта; нажат только выбранный", async () => {
    const el = await mount({ value: "b", onChange: () => {} });
    expect(items(el).map((b) => b.textContent)).toEqual(["Аня", "Игорь", "Марк"]);
    expect(items(el).map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    expect(items(el).every((b) => b.type === "button")).toBe(true);
  });

  it("контейнер — группа с переданной подписью", async () => {
    const el = await mount({ value: "a", onChange: () => {} });
    const group = el.querySelector(".segmented")!;
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBe("Кто");
  });

  it("клик по другому зовёт onChange с ключом", async () => {
    const onChange = vi.fn();
    const el = await mount({ value: "a", onChange });
    await act(async () => items(el)[2].click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith("c");
  });

  it("клик по выбранному onChange не зовёт", async () => {
    const onChange = vi.fn();
    const el = await mount({ value: "a", onChange });
    await act(async () => items(el)[0].click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("с reselect клик по выбранному onChange зовёт", async () => {
    const onChange = vi.fn();
    const el = await mount({ value: "a", onChange, reselect: true });
    await act(async () => items(el)[0].click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("без выбранного нажатых нет; disabled гасит все кнопки", async () => {
    const onChange = vi.fn();
    const el = await mount({ value: null, onChange, disabled: true });
    expect(items(el).map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "false"]);
    expect(items(el).every((b) => b.disabled)).toBe(true);
  });
  // Пункты — настоящие кнопки: Enter и Пробел на сфокусированной кнопке дают click,
  // отдельной клавиатурной логики в компоненте нет и быть не должно.
  it("с клавиатуры: каждый пункт достижим по Tab, фокус и «Enter» (click) зовут onChange", async () => {
    const onChange = vi.fn();
    const el = await mount({ value: "a", onChange });
    expect(items(el).every((b) => b.getAttribute("tabindex") !== "-1" && b.tabIndex >= 0)).toBe(true);

    const target = items(el)[1];
    act(() => target.focus());
    expect(document.activeElement).toBe(target);
    await act(async () => (document.activeElement as HTMLButtonElement).click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith("b");
  });
});
