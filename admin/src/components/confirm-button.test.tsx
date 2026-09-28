// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmButton } from "./ConfirmButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(onConfirm: () => void) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(ConfirmButton, {
      label: "В архив", question: "Убрать в архив?", confirmLabel: "Да, в архив", onConfirm,
    }));
  });
  return host;
}

const click = async (el: HTMLElement, text: string) => {
  const btn = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
  if (!btn) throw new Error(`нет кнопки «${text}»`);
  await act(async () => { btn.click(); });
};

describe("ConfirmButton", () => {
  it("первое нажатие только спрашивает", async () => {
    const onConfirm = vi.fn();
    const el = await mount(onConfirm);
    await click(el, "В архив");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(el.textContent).toContain("Убрать в архив?");
  });

  it("подтверждение делает", async () => {
    const onConfirm = vi.fn();
    const el = await mount(onConfirm);
    await click(el, "В архив");
    await click(el, "Да, в архив");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("«Отмена» возвращает кнопку и ничего не делает", async () => {
    const onConfirm = vi.fn();
    const el = await mount(onConfirm);
    await click(el, "В архив");
    await click(el, "Отмена");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(el.textContent).not.toContain("Убрать в архив?");
  });
});
