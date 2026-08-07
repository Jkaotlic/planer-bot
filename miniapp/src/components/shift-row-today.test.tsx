// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ShiftRow } from "./ShiftRow";
import type { Shift, Template } from "../api/client";

/**
 * «Сегодня» жил рядом со временем — внутри заголовка `Cell`, а тот режет
 * содержимое (`overflow: hidden; text-overflow: ellipsis`) по ширине, которая
 * останется от бейджа дня и «Обменять». На Android telegram-ui отдаёт
 * «base»-метрики (gap 24, padding 24), и это 58px из 240 при экране 320 и 98px
 * при 360 — при нужных 127. Чип рисовался ЗА границей отсечения: замер в
 * Chromium показал «видно 0 из 66px» на 320 и 360 и 28 из 66 на 390.
 *
 * Ширину строки этим не вылечить, поэтому чип переехал в правую колонку, к
 * «Обменять»: она растягивается по содержимому, и её ширину и так задаёт
 * «Обменять» — то есть чип не отнимает у строки ни пикселя ни на одной ширине.
 *
 * jsdom не считает раскладку, поэтому тест держит не пиксели, а само правило:
 * чип живёт в одном контейнере с «Обменять», а не внутри усечённого заголовка.
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

const shift: Shift = {
  id: 1,
  employeeId: 7,
  date: "2026-08-03",
  endDate: null,
  start: "08:00",
  end: "17:00",
  category: "shift",
  title: "Утро",
  templateId: 1,
  note: null,
  location: null,
  unrecognisedCode: null,
} as Shift;

const templates: Template[] = [];

async function render(node: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // `Cell` читает платформу из контекста `AppRoot` — без обёртки telegram-ui бросает.
  await act(async () => root!.render(createElement(AppRoot, null, node)));
  return host;
}

function findByText(el: HTMLElement, text: string): HTMLElement {
  // "Обменять" — теперь настоящая `<button>` (см. ShiftRow), не `span`.
  const found = [...el.querySelectorAll("span,div,button")].find((n) => (n.textContent ?? "").trim() === text);
  if (!found) throw new Error(`не нашёл элемент с текстом «${text}»`);
  return found as HTMLElement;
}

describe("«Сегодня» в строке смены", () => {
  it("стоит в правой колонке рядом с «Обменять», а не внутри заголовка со временем", async () => {
    const el = await render(
      createElement(ShiftRow, { shift, templates, isToday: true, onSwap: () => {} }),
    );

    const today = findByText(el, "Сегодня");
    const swap = findByText(el, "Обменять");
    expect(today.parentElement, "чип и «Обменять» — соседи в одном столбике").toBe(swap.parentElement);

    // И главное: заголовок со временем его больше не содержит.
    const time = findByText(el, "08:00–17:00");
    expect(time.contains(today), "заголовок Cell режет содержимое — чипу там не место").toBe(false);
  });

  it("показывается и без «Обменять» — у записи, которую менять нельзя", async () => {
    const el = await render(
      createElement(ShiftRow, { shift: { ...shift, category: "vacation" } as Shift, templates, isToday: true }),
    );
    expect((el.textContent ?? "").includes("Сегодня")).toBe(true);
    expect((el.textContent ?? "").includes("Обменять")).toBe(false);
  });

  it("не показывается на любой другой день", async () => {
    const el = await render(createElement(ShiftRow, { shift, templates, onSwap: () => {} }));
    expect((el.textContent ?? "").includes("Сегодня")).toBe(false);
  });
});
