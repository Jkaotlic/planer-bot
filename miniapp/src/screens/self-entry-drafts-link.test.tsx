// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { SelfEntryScreen, selfEntryFormFolded } from "./SelfEntryScreen";
import type { HandoverDraft, Shift } from "../api/client";

/**
 * Открыли по ссылке «Выбрать коллег» из письма об ОК: человек пришёл за вторым шагом —
 * «кому предложить смену», а не за новой записью. Поля даты и кнопка «Поставить
 * больничный» стояли выше черновиков (~440px) и уводили первую кнопку-кандидата
 * за нижний край экрана; в этом режиме форма свёрнута до одной кнопки.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-10-05";
const DRAFT: HandoverDraft = {
  id: 77,
  shiftLine: "Вт 6 окт · 09:00–18:00 · День",
  candidates: [{ id: 2, displayName: "Игорь" }],
};
const MY_SICK: Shift = {
  id: 21, date: "2026-10-06", start: null, end: null, endDate: "2026-10-07",
  category: "sick_leave", title: null, location: null, note: null,
  unrecognisedCode: null, templateId: null, employeeId: 1,
} as Shift;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function render(loadDrafts?: () => Promise<HandoverDraft[]>) {
  await act(async () => {
    root!.render(
      createElement(
        AppRoot,
        null,
        createElement(SelfEntryScreen, {
          mode: "sick" as const, today: TODAY, shifts: [MY_SICK], templates: [], ownShifts: false,
          onCancel: vi.fn(), onCreate: vi.fn(async () => []), onUpdate: vi.fn(async () => {}), onDelete: vi.fn(async () => {}),
          onOfferHandover: vi.fn(async () => {}), onSkipHandover: vi.fn(async () => {}), loadDrafts,
        }),
      ),
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  return host!;
}

const dateInputs = (el: HTMLElement) => el.querySelectorAll('input[type="date"]').length;
const buttonWith = (el: HTMLElement, text: string) => [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));

describe("selfEntryFormFolded", () => {
  it("по ссылке с черновиками форма свёрнута, пока её не раскрыли", () => {
    expect(selfEntryFormFolded({ draftsLink: true, expanded: false })).toBe(true);
    expect(selfEntryFormFolded({ draftsLink: true, expanded: true })).toBe(false);
  });
  it("обычное открытие — форма всегда развёрнута", () => {
    expect(selfEntryFormFolded({ draftsLink: false, expanded: false })).toBe(false);
    expect(selfEntryFormFolded({ draftsLink: false, expanded: true })).toBe(false);
  });
});

describe("форма больничного по ссылке «Выбрать коллег»", () => {
  it("свёрнута: нет полей даты и «Поставить больничный», черновик на месте", async () => {
    const el = await render(async () => [DRAFT]);
    expect(dateInputs(el)).toBe(0);
    expect(buttonWith(el, "Поставить больничный")).toBeUndefined();
    expect(el.textContent).toContain("Кому предложить смену");
    expect(buttonWith(el, "Игорь")).toBeTruthy();
  });

  it("кнопка «Записать ещё один больничный» раскрывает форму", async () => {
    const el = await render(async () => [DRAFT]);
    await act(async () => { buttonWith(el, "Записать ещё один больничный")!.click(); });
    expect(dateInputs(el)).toBe(2);
    expect(buttonWith(el, "Поставить больничный")).toBeTruthy();
    expect(buttonWith(el, "Записать ещё один больничный")).toBeUndefined();
  });

  it("«Изменить» у записи раскрывает форму — правка без полей невозможна", async () => {
    const el = await render(async () => [DRAFT]);
    await act(async () => { buttonWith(el, "Изменить")!.click(); });
    expect(dateInputs(el)).toBe(2);
    expect(buttonWith(el, "Сохранить")).toBeTruthy();
  });

  it("ошибка загрузки черновиков видна и при свёрнутой форме", async () => {
    const el = await render(async () => { throw new Error("Не нашли смены"); });
    expect(el.textContent).toContain("Не нашли смены");
  });

  it("обычное открытие (без ссылки) форму не сворачивает", async () => {
    const el = await render();
    expect(dateInputs(el)).toBe(2);
    expect(buttonWith(el, "Поставить больничный")).toBeTruthy();
    expect(buttonWith(el, "Записать ещё один больничный")).toBeUndefined();
  });
});
