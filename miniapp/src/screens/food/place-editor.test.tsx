// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type PlaceView } from "../../api/client";
import { PlaceEditor } from "./PlaceEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = null; host = null; vi.restoreAllMocks(); });
async function settle(times = 10) { for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); }
function byText(el: HTMLElement, text: string) {
  return [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
}
function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function mountEditor(props: { place: PlaceView | null; onSaved(p: PlaceView): void }) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(PlaceEditor, { ...props, onCancel: vi.fn() })));
  });
  await settle();
  return host;
}

describe("PlaceEditor", () => {
  it("добавляет блюдо строкой и сохраняет место с меню", async () => {
    const save = vi.spyOn(apiClient, "saveFoodPlace").mockResolvedValue({ id: 1, name: "Шаурмечная", menu: [] });
    const onSaved = vi.fn();
    const el = await mountEditor({ place: null, onSaved });
    await act(async () => type(el.querySelector<HTMLInputElement>("input[name=place-name]")!, "Шаурмечная"));
    await act(async () => byText(el, "+ Блюдо").click());
    await act(async () => type(el.querySelector<HTMLInputElement>("input[name=dish-name-0]")!, "Шаурма"));
    await act(async () => type(el.querySelector<HTMLInputElement>("input[name=dish-price-0]")!, "350"));
    await act(async () => byText(el, "Сохранить").click());
    await settle();
    expect(save).toHaveBeenCalledWith(null, { name: "Шаурмечная", menu: [{ name: "Шаурма", price: 350 }] });
    expect(onSaved).toHaveBeenCalled();
  });

  it("при правке сохраняет id блюд — кнопки в разосланных письмах не ломаются", async () => {
    const save = vi.spyOn(apiClient, "saveFoodPlace").mockResolvedValue({ id: 5, name: "Додо", menu: [] });
    const el = await mountEditor({ place: { id: 5, name: "Додо", menu: [{ id: 9, name: "Пицца", price: 600 }] }, onSaved: vi.fn() });
    await act(async () => byText(el, "Сохранить").click());
    await settle();
    expect(save).toHaveBeenCalledWith(5, { name: "Додо", menu: [{ id: 9, name: "Пицца", price: 600 }] });
  });
});
