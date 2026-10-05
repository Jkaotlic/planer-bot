// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { SelfEntryScreen } from "./SelfEntryScreen";
import type { HandoverDraft, Shift } from "../api/client";

/**
 * Второй шаг формы больничного: «кому отдать смену».
 *
 * Проверяется поведение, а не вёрстка: что форма НЕ закрывается, пока смена
 * висит без человека, что «Потом» уходит в веер, а не молчит, и что больничный
 * без смен закрывает форму сразу — как было до этой работы.
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-08-12";

/** Своя запись, которую видно в списке «Что ты уже записал себе»: категория из
 *  тех двух, что можно ставить самому, и дата не в прошлом (`selfEntryEditRefusal`). */
const MY_ENTRY: Shift = {
  id: 21, date: TODAY, start: null, end: null, endDate: null,
  category: "offsite", title: "Конференция", location: null, note: null,
  unrecognisedCode: null, templateId: null, employeeId: 1,
} as Shift;

const DRAFT: HandoverDraft = {
  id: 77,
  shiftLine: "Ср 12 авг · 09:00–18:00 · День",
  candidates: [
    { id: 2, displayName: "Игорев Игорь" },
    { id: 3, displayName: "Маркин Марк" },
  ],
};

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

async function render(props: Partial<Parameters<typeof SelfEntryScreen>[0]> = {}) {
  const onCreate = props.onCreate ?? vi.fn(async () => [DRAFT]);
  const screen = createElement(SelfEntryScreen, {
    mode: "sick" as const,
    today: TODAY,
    shifts: [] as Shift[],
    templates: [],
    ownShifts: false,
    onCancel: vi.fn(),
    onCreate,
    onUpdate: vi.fn(async () => {}),
    onDelete: vi.fn(async () => {}),
    onOfferHandover: vi.fn(async () => {}),
    onSkipHandover: vi.fn(async () => {}),
    ...props,
  });
  await act(async () => root!.render(createElement(AppRoot, null, screen)));
  return host!;
}

function buttonWith(el: HTMLElement, text: string): HTMLElement | undefined {
  return [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
}

async function saveSickLeave(el: HTMLElement) {
  const save = buttonWith(el, "Поставить больничный")!;
  await act(async () => save.click());
}

describe("второй шаг формы", () => {
  it("после больничного показывает смену и кандидатов, а не закрывает форму", async () => {
    const el = await render();

    await saveSickLeave(el);

    const text = el.textContent ?? "";
    expect(text).toContain("09:00–18:00");
    expect(text).toContain("Игорев Игорь");
    expect(text).toContain("Маркин Марк");
  });

  it("нажатие на коллегу отправляет предложение именно ему", async () => {
    const onOfferHandover = vi.fn(async () => {});
    const el = await render({ onOfferHandover });

    await saveSickLeave(el);
    await act(async () => buttonWith(el, "Маркин Марк")!.click());

    expect(onOfferHandover).toHaveBeenCalledWith(77, 3);
  });

  // Кнопка называлась «Потом», а сервер по ней сразу пишет всем свободным —
  // название обещало обратное тому, что происходит.
  it("«Спросить всех свободных» — название говорит, что сделает", async () => {
    const onSkipHandover = vi.fn(async () => {});
    const el = await render({ onSkipHandover });

    await saveSickLeave(el);
    expect(buttonWith(el, "Потом")).toBeUndefined();
    await act(async () => buttonWith(el, "Спросить всех свободных")!.click());

    expect(onSkipHandover).toHaveBeenCalledWith(77);
  });

  it("«Назад» с неотданной сменой сначала предупреждает, второе нажатие уходит", async () => {
    const onCancel = vi.fn();
    const el = await render({ onCancel });

    await saveSickLeave(el);
    const back = el.querySelector<HTMLButtonElement>('button[aria-label="Назад"]')!;
    await act(async () => back.click());
    expect(onCancel).not.toHaveBeenCalled();
    expect(el.textContent ?? "").toContain("через три часа спросим всех свободных");

    await act(async () => back.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("больничный без смен закрывает форму сразу, как раньше", async () => {
    const el = await render({ onCreate: vi.fn(async () => []) });

    await saveSickLeave(el);

    // Второго шага нет: форма вернулась к пустому вводу.
    expect(el.textContent ?? "").not.toContain("Кому предложить");
    expect(buttonWith(el, "Поставить больничный")).toBeDefined();
  });

  it("когда свободных нет, говорит об этом, а не показывает пустой список", async () => {
    const lonely: HandoverDraft = { ...DRAFT, candidates: [] };
    const el = await render({ onCreate: vi.fn(async () => [lonely]) });

    await saveSickLeave(el);

    expect(el.textContent ?? "").toContain("Свободных нет");
  });

  // Кнопка называлась «Потом» и молчала — теперь она всегда «Спросить всех
  // свободных», даже когда свободных нет: спрашивать в этом случае некого, но
  // название не должно врать, что сделает, и «Понятно» — не то же самое действие.
  it("свободных нет — кнопка всё равно «Понятно», а не «Спросить всех свободных»", async () => {
    const lonely: HandoverDraft = { ...DRAFT, candidates: [] };
    const el = await render({ onCreate: vi.fn(async () => [lonely]) });

    await saveSickLeave(el);

    expect(buttonWith(el, "Понятно")).toBeDefined();
    expect(buttonWith(el, "Спросить всех свободных")).toBeUndefined();
  });
});

describe("«Снять» свою запись — необратимое действие спрашивает", () => {
  // Прямая кнопка убирала бы запись с одного тапа; «Снять» шлёт админам письмо,
  // и отменить нечем — как «Не смогу» и «Удалить запись» в остальных формах.
  it("одно нажатие не снимает запись, а сперва спрашивает", async () => {
    const onDelete = vi.fn(async () => {});
    const el = await render({ shifts: [MY_ENTRY], onDelete });

    const btn = buttonWith(el, "Снять")!;
    expect(btn).toBeDefined();
    await act(async () => btn.click());

    expect(onDelete).not.toHaveBeenCalled();
    expect(el.textContent ?? "").toContain("Снять эту запись?");
  });

  it("пока больничный ждёт ОК — форма говорит, что смены предложат после ОК, а запись помечена «ждёт ОК»", async () => {
    const pending = { ...MY_ENTRY, id: 22, category: "sick_leave", title: null, pending: true } as Shift;
    const el = await render({ shifts: [pending], onCreate: vi.fn(async () => []) });
    expect(el.textContent).toContain("Админы подтвердят — после этого предложим твои смены коллегам");
    expect(el.textContent).toContain("ждёт ОК");
  });

  it("без ждущего больничного этой строки нет", async () => {
    const el = await render({ shifts: [MY_ENTRY] });
    expect(el.textContent).not.toContain("Админы подтвердят");
  });

  it("подтверждённый больничный (без pending) не помечен «ждёт ОК»", async () => {
    const approved = { ...MY_ENTRY, id: 23, category: "sick_leave", title: null } as Shift;
    const el = await render({ shifts: [approved] });
    expect(el.textContent).not.toContain("ждёт ОК");
  });
});
