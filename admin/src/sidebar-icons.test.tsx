// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Sidebar } from "./components/Sidebar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("иконки пунктов сайдбара", () => {
  // Иконка «Виды смен» была 20px при 18 у остальных: пункт выходил 40px против 38
  // (замер в браузере), и ряд пунктов был неровным.
  it("у всех пунктов иконка одного размера — 18px", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(Sidebar, { active: "schedule", onChange: () => {}, adminLabel: "Аня", open: false })); });
    const sizes = [...host.querySelectorAll(".sidebar-nav-icon svg")].map((svg) => `${svg.getAttribute("width")}x${svg.getAttribute("height")}`);
    expect(sizes.length).toBeGreaterThan(10);
    expect(new Set(sizes)).toEqual(new Set(["18x18"]));
  });
});
