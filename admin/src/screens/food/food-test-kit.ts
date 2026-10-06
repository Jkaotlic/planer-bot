import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";

// Шесть файлов тестов экранов «Заказы и опросы» рисуют компонент одинаково —
// один кит вместо шести копий `mount`/`click`/`type`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

export async function mount<P extends object>(component: ComponentType<P>, props: P): Promise<HTMLDivElement> {
  // Тест, который монтирует второй раз (после `unmount()` внутри него или без него),
  // иначе терял бы ссылку на первый корень: тот жил бы в `document.body` до конца файла.
  await unmount();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(component, props)));
  return host;
}

export async function unmount(): Promise<void> {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
}

export function maybeButton(el: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...el.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  );
}

export function button(el: ParentNode, label: string): HTMLButtonElement {
  const found = maybeButton(el, label);
  if (!found) throw new Error(`нет кнопки «${label}»`);
  return found;
}

export async function click(el: HTMLElement): Promise<void> {
  await act(async () => el.click());
}

export async function type(field: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export { waitFor } from "../../test-wait";
