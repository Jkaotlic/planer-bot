// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { SelfEntryScreen, monthStartOf, usesAdminRoute, withOwnPast } from "./SelfEntryScreen";
import type { NewEntryInput, Shift } from "../api/client";

/**
 * «Записать себе» у админа. Его правило 2026-10-15: «админы в любом случае могут
 * менять любому что и когда захотят» — себе тоже. До этой правки владелец не мог
 * поправить свой идущий отпуск 12–17: экран держал его правилами работника и
 * отпуска в списке не показывал вовсе.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-10-15";
const ME = 9;

const VACATION = {
  id: 77, date: "2026-10-12", start: null, end: null, endDate: "2026-10-17",
  category: "vacation", title: null, location: null, note: null,
  unrecognisedCode: null, templateId: null, employeeId: ME,
} as Shift;

/** Кончился позавчера: работнику уже не тронуть. */
const ENDED_SICK = {
  id: 78, date: "2026-10-10", start: null, end: null, endDate: "2026-10-13",
  category: "sick_leave", title: null, location: null, note: null,
  unrecognisedCode: null, templateId: null, employeeId: ME,
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

function handlers() {
  return {
    onCreate: vi.fn(async () => []),
    onUpdate: vi.fn(async () => {}),
    onDelete: vi.fn(async () => {}),
    onAdminCreate: vi.fn(async (_input: NewEntryInput) => {}),
    onAdminUpdate: vi.fn(async (_id: number, _input: NewEntryInput) => {}),
    onAdminDelete: vi.fn(async (_id: number) => {}),
  };
}

async function render(isAdmin: boolean, shifts: Shift[], h = handlers()) {
  const screen = createElement(SelfEntryScreen, {
    mode: "sick" as const,
    today: TODAY,
    shifts,
    templates: [],
    ownShifts: false,
    isAdmin,
    myId: ME,
    onCancel: vi.fn(),
    onOfferHandover: vi.fn(async () => {}),
    onSkipHandover: vi.fn(async () => {}),
    ...h,
  });
  await act(async () => root!.render(createElement(AppRoot, null, screen)));
  return { el: host!, h };
}

const buttons = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === text);

async function setInput(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function setSelect(field: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const dateInputs = (el: HTMLElement) => [...el.querySelectorAll<HTMLInputElement>('input[type="date"]')];

describe("куда уходит запись админа", () => {
  it("больничный и мероприятие — своей ручкой (передачи, письмо админам), остальное — админской", () => {
    expect(usesAdminRoute("sick_leave", { admin: true })).toBe(false);
    expect(usesAdminRoute("offsite", { admin: true })).toBe(false);
    expect(usesAdminRoute("vacation", { admin: true })).toBe(true);
    expect(usesAdminRoute("duty", { admin: true })).toBe(true);
    expect(usesAdminRoute("shift", { admin: true })).toBe(true);
    // Наблюдатель-админ со своим графиком: смена идёт его ручкой, как у наблюдателя.
    expect(usesAdminRoute("shift", { admin: true, ownShifts: true })).toBe(false);
    // Работнику админская ручка не положена никогда.
    expect(usesAdminRoute("vacation", {})).toBe(false);
  });
});

describe("«Записать себе» у админа", () => {
  it("в списке — идущий отпуск и кончившийся больничный, подписи «прошедшее правит админ» нет", async () => {
    const { el } = await render(true, [ENDED_SICK, VACATION]);
    expect(buttons(el, "Изменить")).toHaveLength(2);
    expect(el.textContent).not.toContain("прошедшее правит админ");
  });

  it("сократить свой отпуск до одного дня: админская ручка, endDate: null", async () => {
    const { el, h } = await render(true, [VACATION]);
    await act(async () => buttons(el, "Изменить")[0]!.click());
    const to = dateInputs(el).find((i) => i.value === "2026-10-17")!;
    await setInput(to, "2026-10-12");
    await act(async () => buttons(el, "Сохранить")[0]!.click());

    expect(h.onUpdate).not.toHaveBeenCalled();
    expect(h.onAdminUpdate).toHaveBeenCalledTimes(1);
    expect(h.onAdminUpdate.mock.calls[0]).toEqual([77, { category: "vacation", date: "2026-10-12", endDate: null, employeeId: ME }]);
  });

  it("продлить отпуск: endDate уезжает новой датой", async () => {
    const { el, h } = await render(true, [VACATION]);
    await act(async () => buttons(el, "Изменить")[0]!.click());
    await setInput(dateInputs(el).find((i) => i.value === "2026-10-17")!, "2026-10-20");
    await act(async () => buttons(el, "Сохранить")[0]!.click());
    expect(h.onAdminUpdate.mock.calls[0]![1]).toMatchObject({ endDate: "2026-10-20" });
  });

  it("кончившийся больничный правится своей ручкой — без отказа «уже кончилась»", async () => {
    const { el, h } = await render(true, [ENDED_SICK]);
    await act(async () => buttons(el, "Изменить")[0]!.click());
    await act(async () => buttons(el, "Сохранить")[0]!.click());
    expect(el.textContent).not.toContain("кончилась");
    expect(h.onUpdate).toHaveBeenCalledWith(78, { category: "sick_leave", date: "2026-10-10", endDate: "2026-10-13" });
    expect(h.onAdminUpdate).not.toHaveBeenCalled();
  });

  it("форма предлагает все семь видов, и отпуск себе ставится админской ручкой", async () => {
    const { el, h } = await render(true, []);
    const kind = el.querySelector<HTMLSelectElement>("select")!;
    expect(kind).not.toBeNull();
    expect([...kind.options].map((o) => o.value).sort()).toEqual(
      ["business_trip", "duty", "offsite", "shift", "sick_leave", "vacation", "weekend_work"],
    );
    await setSelect(kind, "vacation");
    const [from, to] = dateInputs(el);
    await setInput(from!, "2026-11-02");
    await setInput(to!, "2026-11-06");
    const submit = [...el.querySelectorAll("button")].find((b) => /Поставить себе/.test(b.textContent ?? ""))!;
    await act(async () => submit.click());

    expect(h.onCreate).not.toHaveBeenCalled();
    expect(h.onAdminCreate).toHaveBeenCalledWith({ category: "vacation", date: "2026-11-02", endDate: "2026-11-06", employeeId: ME });
  });

  it("больничный задним числом за месяц — без отказа, своей ручкой", async () => {
    const { el, h } = await render(true, []);
    await setInput(dateInputs(el)[0]!, "2026-09-10");
    await act(async () => [...el.querySelectorAll("button")].find((b) => /Поставить больничный/.test(b.textContent ?? ""))!.click());
    expect(h.onCreate).toHaveBeenCalledWith({ category: "sick_leave", date: "2026-09-10", endDate: null });
  });

  it("снять отпуск — админской ручкой, больничный — своей", async () => {
    const { el, h } = await render(true, [ENDED_SICK, VACATION]);
    for (const id of [0, 1]) {
      await act(async () => buttons(el, "Снять")[id]!.click());
      await act(async () => buttons(el, "Да, снять")[0]!.click());
    }
    expect(h.onDelete).toHaveBeenCalledWith(78);
    expect(h.onAdminDelete).toHaveBeenCalledWith(77);
  });
});

describe("своя смена админа с пресетом", () => {
  const MORNING = {
    id: 79, date: "2026-10-20", start: "08:00", end: "17:00", endDate: null,
    category: "shift", title: "Утро", location: null, note: null,
    unrecognisedCode: null, templateId: 1, employeeId: ME,
  } as Shift;

  it("перенос на другой день сохраняет пресет — иначе сервер снял бы цвет и код «Утра»", async () => {
    const { el, h } = await render(true, [MORNING]);
    await act(async () => buttons(el, "Изменить")[0]!.click());
    await setInput(dateInputs(el)[0]!, "2026-10-21");
    await act(async () => buttons(el, "Сохранить")[0]!.click());
    expect(h.onAdminUpdate.mock.calls[0]![1]).toMatchObject({ category: "shift", date: "2026-10-21", templateId: 1, title: "Утро" });
  });

  it("свои часы — уже не пресет: templateId не шлётся, подпись снимается", async () => {
    const { el, h } = await render(true, [MORNING]);
    await act(async () => buttons(el, "Изменить")[0]!.click());
    const start = [...el.querySelectorAll<HTMLInputElement>('input[type="time"]')][0]!;
    await setInput(start, "10:00");
    await act(async () => buttons(el, "Сохранить")[0]!.click());
    const body = h.onAdminUpdate.mock.calls[0]![1];
    expect(body).not.toHaveProperty("templateId");
    expect(body).toMatchObject({ start: "10:00", title: null });
  });
});

describe("работнику не меняется ничего", () => {
  it("ни отпуска, ни кончившегося в списке; выбора вида нет; подпись про админа на месте", async () => {
    const { el } = await render(false, [ENDED_SICK, VACATION]);
    expect(buttons(el, "Изменить")).toHaveLength(0);
    expect(el.querySelector("select")).toBeNull();
    expect(el.textContent).toContain("прошедшее правит админ");
  });

  it("больничный за месяц назад — отказ правила, запрос не уходит", async () => {
    const { el, h } = await render(false, []);
    await setInput(dateInputs(el)[0]!, "2026-09-10");
    expect(el.textContent).toContain("Больничный можно поставить не раньше");
    expect(h.onCreate).not.toHaveBeenCalled();
  });
});

describe("окно прошедших записей админа", () => {
  it("начинается с первого числа месяца", () => {
    expect(monthStartOf("2026-10-15")).toBe("2026-10-01");
  });

  it("берёт из графика только свои кончившиеся, без дублей с идущими", () => {
    const schedule = [
      ENDED_SICK,
      VACATION, // идёт сегодня — уже есть в «Моих сменах»
      { ...ENDED_SICK, id: 90, employeeId: 4 }, // чужой
      { ...VACATION, id: 91, date: "2026-10-16", endDate: null }, // будущее
      { ...VACATION, id: 92, date: TODAY, endDate: null }, // кончается сегодня — это ещё «Мои смены», не прошлое
    ];
    expect(withOwnPast([VACATION], schedule, ME, TODAY).map((e) => e.id)).toEqual([78, 77]);
  });
});
