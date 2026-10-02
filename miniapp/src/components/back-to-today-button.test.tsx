// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BackToTodayButton } from "./BackToTodayButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(onClick = () => {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(BackToTodayButton, { label: "Эта неделя", onClick })));
  const button = host.querySelector("button")!;
  return { button, cleanup: async () => { await act(async () => root.unmount()); host.remove(); } };
}

describe("BackToTodayButton", () => {
  it("зона нажатия — не ниже нажимаемого (44px), а фон не заходит на прозрачную рамку", async () => {
    const { button, cleanup } = await render();
    expect(button.style.minHeight).toBe("var(--app-tap)");
    // Фон обрезан по padding-box: рамка 9px сверху и снизу невидима, и таблетка
    // остаётся прежней, 26px.
    // jsdom не знает `background-clip`, поэтому по разметке, а не по CSSOM.
    expect(renderToStaticMarkup(createElement(BackToTodayButton, { label: "А", onClick: () => {} }))).toContain("background-clip:padding-box");
    expect(button.style.borderTop).toContain("9px");
    expect(button.style.borderTop).toContain("transparent");
    // Отрицательный margin компенсирует рамку: высота строки прежняя.
    expect(button.style.marginTop).toBe("-9px");
    expect(button.style.marginBottom).toBe("-9px");
    await cleanup();
  });

  it("нажатие зовёт onClick", async () => {
    const onClick = vi.fn();
    const { button, cleanup } = await render(onClick);
    await act(async () => button.click());
    expect(onClick).toHaveBeenCalledTimes(1);
    await cleanup();
  });
});
