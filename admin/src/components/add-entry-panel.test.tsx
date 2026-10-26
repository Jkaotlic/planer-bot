// @vitest-environment jsdom
import { act, createElement } from "react";
import { EMPTY_CALENDAR } from "@planer/shared";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddEntryPanel, type AddEntryPanelProps } from "./AddEntryPanel";
import type { Employee, NewEntryInput, NewEntryRangeInput, Shift, Template } from "../api/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const employee: Employee = {
  id: 1, displayName: "Иванов Иван", isAdmin: false, isActive: true,
  telegramUserId: null, birthDate: null, preferredName: null, address: "Иван",
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, remindersEnabled: true,
};

const template = (over: Partial<Template>): Template => ({
  id: 1, name: "Утро", accent: "gold", start: "08:00", end: "17:00",
  fridayStart: "08:00", fridayEnd: "15:45", isLate: false, sendReminder: true,
  category: "shift", location: null, sortOrder: 1, ...over,
});

/** Пресеты, ради которых задача: смена и дежурство идут вперемешку по sortOrder. */
const TEMPLATES: Template[] = [
  template({ id: 1, name: "Утро", category: "shift", sortOrder: 1 }),
  template({ id: 2, name: "Дежурство · Поклонка", category: "duty", sortOrder: 2, location: "Поклонка" }),
  template({ id: 3, name: "День", category: "shift", sortOrder: 3, start: "09:00", end: "18:00", fridayEnd: "16:45" }),
];

/** Отпуск, заведённый импортом: начинается в показанной неделе, кончается через две. */
const longVacation: Shift = {
  id: 10, date: "2026-06-08", start: null, end: null, endDate: "2026-06-22",
  category: "vacation", title: null, location: null, unrecognisedCode: null,
  templateId: null, employeeId: 1,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(props: Partial<AddEntryPanelProps> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(AddEntryPanel, {
        employees: [employee],
        templates: TEMPLATES,
        initialEmployeeId: 1,
        initialDate: "2026-06-08",
        calendar: EMPTY_CALENDAR,
        onCancel: () => {},
        onSave: async () => {},
        ...props,
      }),
    );
  });
  return host;
}

function optionByText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll<HTMLButtonElement>(".preset-option, .category-option")].find((b) =>
    (b.textContent ?? "").includes(text),
  );
  if (!found) throw new Error(`не нашёл вариант «${text}»`);
  return found;
}

async function setInput(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("AddEntryPanel — один список видов", () => {
  /**
   * Его правка от 2026-08-21: «Смены и дежурства должны быть все вместе, не надо
   * их разделять». До неё панель спрашивала категорию и только потом показывала
   * `templates.filter((t) => t.category === выбранная)` — увидеть дежурство, не
   * сказав сперва «Дежурство», было нельзя.
   */
  it("показывает смены и дежурства в одном списке, без шага «Категория»", async () => {
    const el = await mount();
    const names = [...el.querySelectorAll(".preset-option .preset-name")].map((n) => n.textContent);
    expect(names).toEqual(["Утро", "Дежурство · Поклонка", "День", "Своё время"]);

    // Кнопок «Смена» и «Дежурство» на верхнем уровне больше нет: категория едет
    // из пресета. Осталась только группа отсутствий.
    const categories = [...el.querySelectorAll(".category-option")].map((n) => n.textContent);
    expect(categories).toEqual(["Отпуск", "Больничный", "Командировка"]);
  });

  it("выбирает дежурство одним нажатием и шлёт его категорию", async () => {
    let saved: NewEntryInput | null = null;
    const el = await mount({ onSave: async (input) => { saved = input; } });

    await act(async () => optionByText(el, "Дежурство · Поклонка").click());
    await act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent === "Сохранить")!.click());

    expect(saved).toMatchObject({
      category: "duty", templateId: 2, title: "Дежурство · Поклонка", date: "2026-06-08", employeeId: 1,
    });
  });

  it("«Своё время» спрашивает категорию — её больше неоткуда взять", async () => {
    let saved: NewEntryInput | null = null;
    const el = await mount({ onSave: async (input) => { saved = input; } });

    await act(async () => optionByText(el, "Своё время").click());
    const kinds = [...el.querySelectorAll(".category-option")].map((n) => n.textContent);
    expect(kinds).toContain("Смена");
    expect(kinds).toContain("Дежурство");

    await act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent === "Сохранить")!.click());
    expect(saved).toMatchObject({ category: "shift", start: "09:00", end: "18:00" });
    expect(saved).not.toHaveProperty("templateId");
  });
});

describe("AddEntryPanel — диапазон дат", () => {
  /**
   * Прежняя панель предлагала день выпадающим списком из семи дат показанной
   * недели. У отпуска, кончающегося позже воскресенья, своего варианта в списке
   * не было: браузер показывал первый, то есть экран сообщал админу, что отпуск
   * кончается в понедельник, а одно касание селекта молча обрезало его до конца
   * недели. С настоящим полем даты выразить нечего — оно держит любую.
   */
  it("показывает срок правящегося отпуска целиком, даже за пределами недели", async () => {
    const el = await mount({ existing: longVacation });
    expect(el.querySelector<HTMLInputElement>("#entry-from")!.value).toBe("2026-06-08");
    expect(el.querySelector<HTMLInputElement>("#entry-to")!.value).toBe("2026-06-22");
  });

  it("считает, сколько дней поставится, и не берёт выходные без спроса", async () => {
    const el = await mount({ onSaveRange: async () => {} });
    // 2026-06-08 — понедельник, 2026-06-14 — воскресенье.
    await setInput(el.querySelector<HTMLInputElement>("#entry-to")!, "2026-06-14");
    expect(el.querySelector('[data-testid="range-preview"]')!.textContent)
      .toContain("5 дней · пропущено 2: 2 выходных");
  });

  it("с галочкой «включая выходные» берёт все семь", async () => {
    const el = await mount({ onSaveRange: async () => {} });
    await setInput(el.querySelector<HTMLInputElement>("#entry-to")!, "2026-06-14");
    await act(async () => el.querySelector<HTMLInputElement>(".range-weekends input")!.click());
    expect(el.querySelector('[data-testid="range-preview"]')!.textContent).toContain("7 дней");
  });

  it("шлёт диапазон в свою ручку, а не по записи за раз", async () => {
    let saved: NewEntryRangeInput | null = null;
    const el = await mount({ onSaveRange: async (input) => { saved = input; } });

    await setInput(el.querySelector<HTMLInputElement>("#entry-to")!, "2026-06-12");
    await act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent === "Сохранить")!.click());

    expect(saved).toMatchObject({
      employeeId: 1, from: "2026-06-08", to: "2026-06-12", category: "shift", templateId: 1, includeWeekends: false,
    });
  });

  // Один день — прежнее поведение слово в слово: обычная ручка, никаких
  // пропусков занятых дней. Иначе вторая запись на тот же день (смена плюс
  // дежурство) перестала бы ставиться вовсе.
  it("один день по-прежнему идёт обычной ручкой", async () => {
    let single = 0;
    let ranged = 0;
    const el = await mount({
      onSave: async () => { single += 1; },
      onSaveRange: async () => { ranged += 1; },
    });
    await act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent === "Сохранить")!.click());
    expect([single, ranged]).toEqual([1, 0]);
  });

  it("добавление шлёт расстановку: занятые дни не трогает", async () => {
    let saved: NewEntryRangeInput | null = null;
    const el = await mount({ onSaveRange: async (input) => { saved = input; } });

    await setInput(el.querySelector<HTMLInputElement>("#entry-to")!, "2026-06-12");
    await act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent === "Сохранить")!.click());

    expect(saved).toMatchObject({ mode: "fill" });
    expect(el.querySelector('[data-testid="range-preview"]')!.textContent).toContain("пропустятся");
  });
});

/**
 * Правка отрезком: «сделай так со вторника по пятницу».
 *
 * Отличается от добавления одним — занятые дни не пропускаются, а переписываются.
 * Поэтому предпросмотр обязан сказать это словами: числа занятых панель не знает
 * (расписания за пределами показанной недели у неё нет), а необратимая операция,
 * ушедшая вслепую, — худшее, чем может кончиться эта форма.
 */
describe("AddEntryPanel — правка отрезком", () => {
  const shift: Shift = {
    ...longVacation, endDate: null, category: "shift", start: "09:00", end: "18:00", templateId: 1, title: "Утро",
  };

  it("у правки есть «по», а не только один день", async () => {
    const el = await mount({ existing: shift, onSaveRange: async () => {} });
    expect(el.querySelector<HTMLInputElement>("#entry-to")!.value).toBe("2026-06-08");
  });

  it("шлёт перезапись, а не расстановку", async () => {
    let saved: NewEntryRangeInput | null = null;
    const el = await mount({ existing: shift, onSaveRange: async (input) => { saved = input; } });

    await setInput(el.querySelector<HTMLInputElement>("#entry-to")!, "2026-06-12");
    await act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent === "Сохранить")!.click());

    expect(saved).toMatchObject({
      employeeId: 1, from: "2026-06-08", to: "2026-06-12", mode: "rewrite", category: "shift", templateId: 1,
    });
  });

  it("предупреждает, что занятые дни будут переписаны, а не пропущены", async () => {
    const el = await mount({ existing: shift, onSaveRange: async () => {} });
    await setInput(el.querySelector<HTMLInputElement>("#entry-to")!, "2026-06-12");

    const text = el.querySelector('[data-testid="range-preview"]')!.textContent ?? "";
    expect(text).toContain("перепишутся");
    expect(text).toContain("отпуск");
    expect(text).not.toContain("пропустятся");
  });

  // Один день — прежняя правка слово в слово: та же запись, тот же id, обычная
  // ручка. Иначе правка часов одной смены начала бы ходить через расстановку.
  it("один день по-прежнему правит запись обычной ручкой", async () => {
    let single = 0;
    let ranged = 0;
    const el = await mount({
      existing: shift,
      onSave: async () => { single += 1; },
      onSaveRange: async () => { ranged += 1; },
    });
    await act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent === "Сохранить")!.click());
    expect([single, ranged]).toEqual([1, 0]);
  });

  // Отпуск в базе — одна строка с `endDate`, и правка его срока обязана остаться
  // правкой ТОЙ ЖЕ строки. Уйди она в расстановку — рядом со старым отпуском
  // появился бы второй, а первый остался бы на месте.
  it("правка срока отпуска остаётся правкой одной записи", async () => {
    let saved: NewEntryInput | null = null;
    let ranged = 0;
    const el = await mount({
      existing: longVacation,
      onSave: async (input) => { saved = input; },
      onSaveRange: async () => { ranged += 1; },
    });
    await act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent === "Сохранить")!.click());

    expect(ranged).toBe(0);
    expect(saved).toMatchObject({ category: "vacation", date: "2026-06-08", endDate: "2026-06-22" });
  });
});

/**
 * «Удалить» — необратимое действие: снимает запись из графика, и вернуть её
 * нечем. Прямая кнопка срабатывала бы с одного клика — отсюда `ConfirmButton`
 * (см. его комментарий в `admin/src/components/ConfirmButton.tsx`).
 */
describe("AddEntryPanel — «Удалить» спрашивает, а не срабатывает сразу", () => {
  const shift: Shift = {
    ...longVacation, endDate: null, category: "shift", start: "09:00", end: "18:00", templateId: 1, title: "Утро",
  };

  it("одно нажатие не удаляет запись, а сперва спрашивает", async () => {
    const onDelete = vi.fn(async () => {});
    const el = await mount({ existing: shift, onDelete });

    const btn = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Удалить");
    expect(btn).toBeDefined();
    await act(async () => btn!.click());

    expect(onDelete).not.toHaveBeenCalled();
    expect(el.textContent).toContain("Удалить запись из графика?");
  });
});

describe("AddEntryPanel — больничный, ждущий ОК", () => {
  const buttonByText = (el: HTMLElement, text: string) => {
    const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);
    if (!found) throw new Error(`не нашёл кнопку «${text}»`);
    return found;
  };
  const pendingSick: Shift = {
    id: 11, date: "2026-06-09", start: null, end: null, endDate: "2026-06-10",
    category: "sick_leave", title: null, location: null, unrecognisedCode: null, templateId: null, employeeId: 1, pending: true,
  };

  it("«✅ ОК» и «❌ Отклонить», и пометка о срочной передаче", async () => {
    const onApprove = vi.fn(async () => {});
    const onReject = vi.fn(async () => {});
    const el = await mount({ existing: pendingSick, onApprove, onReject, handoverForced: true });
    expect(el.textContent).toContain("Больничный ждёт ОК");
    expect(el.textContent).toContain("передача запущена без ОК");
    await act(async () => { buttonByText(el, "✅ ОК").click(); });
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onReject).not.toHaveBeenCalled();
  });

  it("«❌ Отклонить» сначала спрашивает, потом зовёт onReject", async () => {
    const onReject = vi.fn(async () => {});
    const el = await mount({ existing: pendingSick, onApprove: vi.fn(async () => {}), onReject });
    await act(async () => { buttonByText(el, "❌ Отклонить").click(); });
    expect(onReject).not.toHaveBeenCalled();
    await act(async () => { buttonByText(el, "Да, отклонить").click(); });
    expect(onReject).toHaveBeenCalledOnce();
  });

  it("без срочной передачи пометки нет", async () => {
    const el = await mount({ existing: pendingSick, onApprove: vi.fn(async () => {}), onReject: vi.fn(async () => {}) });
    expect(el.textContent).not.toContain("передача запущена без ОК");
  });

  it("у подтверждённого больничного этих кнопок нет", async () => {
    const el = await mount({ existing: { ...pendingSick, pending: undefined }, onApprove: vi.fn(), onReject: vi.fn() });
    expect(el.textContent).not.toContain("✅ ОК");
  });

  it("отказ сервера — текстом в панели", async () => {
    const onApprove = vi.fn(async () => { throw new Error("Уже подтвердил(а) Игорь"); });
    const el = await mount({ existing: pendingSick, onApprove, onReject: vi.fn(async () => {}) });
    await act(async () => { buttonByText(el, "✅ ОК").click(); });
    expect(el.querySelector(".error-text")?.textContent).toContain("Уже подтвердил(а) Игорь");
  });

  it("два быстрых тапа «✅ ОК» — один вызов: после успеха кнопка выключена", async () => {
    const onApprove = vi.fn(async () => {});
    const el = await mount({ existing: pendingSick, onApprove, onReject: vi.fn(async () => {}) });
    const button = buttonByText(el, "✅ ОК");
    await act(async () => { button.click(); });
    await act(async () => { button.click(); });
    expect(button.disabled).toBe(true);
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it("после отказа сервера кнопка снова доступна", async () => {
    const onApprove = vi.fn(async () => { throw new Error("сеть"); });
    const el = await mount({ existing: pendingSick, onApprove, onReject: vi.fn(async () => {}) });
    await act(async () => { buttonByText(el, "✅ ОК").click(); });
    expect(buttonByText(el, "✅ ОК").disabled).toBe(false);
  });
});

/**
 * «— не назначен —»: открытая смена без человека. Мини-апп умеет ставить такую
 * с самого начала; консоль требовала работника, и открытые смены (в том числе
 * будущие смены архивного работника, которые архивация превращает в ничьи) с
 * компьютера были не создать и не увидеть.
 *
 * Границы — ровно мини-аппа и сервера: одиночная запись и полоса отсутствия
 * без человека допустимы (`createEntrySchema`/`updateEntrySchema` принимают
 * `employeeId: null`), расстановка диапазоном — нет (`rangeEntrySchema`: человек
 * обязателен, а «занят ли день» без человека спросить не у кого).
 */
describe("AddEntryPanel — «— не назначен —»", () => {
  const unassigned: Shift = {
    id: 20, date: "2026-06-09", start: "08:00", end: "17:00", endDate: null,
    category: "shift", title: "Утро", location: null, unrecognisedCode: null,
    templateId: 1, employeeId: null,
  };
  const save = (el: HTMLElement) =>
    act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent === "Сохранить")!.click());
  const pickRow = (el: HTMLElement, text: string) =>
    act(async () => [...el.querySelectorAll<HTMLButtonElement>(".person-picker-row")].find((b) => b.textContent === text)!.click());

  it("список работников предлагает строку «— не назначен —»", async () => {
    const el = await mount();
    const rows = [...el.querySelectorAll(".person-picker-row")].map((n) => n.textContent);
    expect(rows).toContain("— не назначен —");
  });

  it("выбранная строка отправляется как employeeId: null", async () => {
    let saved: NewEntryInput | null = null;
    const el = await mount({ onSave: async (input) => { saved = input; } });
    await pickRow(el, "— не назначен —");
    await save(el);
    expect(saved).not.toBeNull();
    expect(saved!.employeeId).toBeNull();
  });

  it("«+» из строки «Не назначено» открывает панель без выбранного человека", async () => {
    const el = await mount({ initialEmployeeId: 0 });
    expect(el.querySelector(".person-picker-chosen")!.textContent).toContain("— не назначен —");
  });

  it("правка ничьей записи показывает «— не назначен —», а не первого работника", async () => {
    // initialEmployeeId: 1 — как в App, где при правке он равен первому из
    // списка: запись без человека не должна «получить» его молча.
    const el = await mount({ existing: unassigned, initialEmployeeId: 1 });
    expect(el.querySelector(".person-picker-chosen")!.textContent).toContain("— не назначен —");
    const selected = [...el.querySelectorAll(".person-picker-row.selected")].map((n) => n.textContent);
    expect(selected).toEqual(["— не назначен —"]);
  });

  it("ничью запись можно назначить человеку", async () => {
    let saved: NewEntryInput | null = null;
    const el = await mount({ existing: unassigned, initialEmployeeId: 1, onSave: async (input) => { saved = input; } });
    await pickRow(el, "Иванов Иван");
    await save(el);
    expect(saved!.employeeId).toBe(1);
  });

  it("правка назначенной записи в «— не назначен —» снимает человека (null), а не молчит", async () => {
    let saved: NewEntryInput | null = null;
    const assigned: Shift = { ...unassigned, employeeId: 1 };
    const el = await mount({ existing: assigned, onSave: async (input) => { saved = input; } });
    await pickRow(el, "— не назначен —");
    await save(el);
    expect(saved!.employeeId).toBeNull();
  });

  it("отсутствие без человека допустимо, как и в мини-аппе: одиночная запись", async () => {
    let saved: NewEntryInput | null = null;
    const el = await mount({ onSave: async (input) => { saved = input; } });
    await pickRow(el, "— не назначен —");
    await act(async () => optionByText(el, "Отпуск").click());
    await save(el);
    expect(saved).toMatchObject({ category: "vacation", employeeId: null });
  });

  it("диапазон без человека не уходит: «Выберите работника», запроса нет", async () => {
    let ranged = 0;
    const el = await mount({ onSaveRange: async () => { ranged += 1; } });
    await pickRow(el, "— не назначен —");
    await setInput(el.querySelector<HTMLInputElement>("#entry-to")!, "2026-06-12");
    await save(el);
    expect(ranged).toBe(0);
    expect(el.querySelector(".error-text")!.textContent).toBe("Выберите работника");
  });

  it("диапазон с человеком по-прежнему уходит", async () => {
    let saved: NewEntryRangeInput | null = null;
    const el = await mount({ onSaveRange: async (input) => { saved = input; } });
    await setInput(el.querySelector<HTMLInputElement>("#entry-to")!, "2026-06-12");
    await save(el);
    expect(saved).toMatchObject({ employeeId: 1 });
  });
});

/**
 * Отпуск 12–17, сокращённый до одного дня. Форма слала тело без `endDate`, а для
 * `PATCH` пропущенное поле — «не менять»: сервер отвечал 200 и оставлял 12–17.
 * Однодневную полосу у правки называют явным `null`.
 */
describe("AddEntryPanel — отсутствие, сокращённое до одного дня", () => {
  it("у правки шлёт endDate: null, а не пропускает поле", async () => {
    let saved: NewEntryInput | null = null;
    const el = await mount({ existing: longVacation, onSave: async (input) => { saved = input; } });

    await setInput(el.querySelector<HTMLInputElement>("#entry-to")!, "2026-06-08");
    await act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent === "Сохранить")!.click());

    expect(saved).not.toBeNull();
    expect(saved!).toHaveProperty("endDate", null);
    expect(saved!.date).toBe("2026-06-08");
  });

  it("у новой однодневной записи endDate по-прежнему не шлётся", async () => {
    let saved: NewEntryInput | null = null;
    const el = await mount({ onSave: async (input) => { saved = input; } });
    await act(async () => optionByText(el, "Отпуск").click());
    await act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent === "Сохранить")!.click());
    expect(saved).toMatchObject({ category: "vacation", date: "2026-06-08" });
    expect(saved!).not.toHaveProperty("endDate");
  });
});

/**
 * Замена отсутствия — зеркало мини-аппа (entry-form-kinds.test.tsx). Прод,
 * 2026-10-16: отпуск, сохранённый «Днём», не менялся вовсе — перезапись его
 * пропускала. Смена вида у отсутствия — явное намерение, и панель шлёт
 * `replaceAbsenceEntryId`; обычная расстановка заменяет только по галочке.
 */
describe("AddEntryPanel — замена отсутствия", () => {
  const save = async (el: HTMLElement) =>
    act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent === "Сохранить")!.click());
  const replaceBox = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((box) => (box.closest("label")?.textContent ?? "").includes("Заменить отпуск и больничный"));

  it("отпуск, переведённый в «День», уходит заменой, а не правкой", async () => {
    let saved: NewEntryRangeInput | null = null;
    let single = 0;
    const el = await mount({
      existing: longVacation,
      onSave: async () => { single += 1; },
      onSaveRange: async (input) => { saved = input; },
    });
    await act(async () => optionByText(el, "День").click());
    expect(el.querySelector('[data-testid="range-preview"]')!.textContent).toContain("Отпуск в эти дни заменится новой записью");
    // Отпуск 8–22 июня, будни: 11 дней заменятся, выходные останутся отпуском.
    expect(el.querySelector('[data-testid="range-preview"]')!.textContent).toContain("11 дней отсутствия заменятся");
    await save(el);

    expect(single).toBe(0);
    expect(saved).toMatchObject({ from: "2026-06-08", to: "2026-06-22", mode: "rewrite", replaceAbsenceEntryId: longVacation.id, templateId: 3 });
    expect(saved).not.toHaveProperty("replaceAbsences");
  });

  // Проверка ветки: у человека второй отпуск 25–30 июня, «По» тянут до 26-го.
  // Общая замена срезала бы и его, о котором панель молчит; уходит id правимого.
  it("«По» за правимым отпуском: в запросе id правимого, а не общая замена", async () => {
    let saved: NewEntryRangeInput | null = null;
    const el = await mount({ existing: longVacation, onSaveRange: async (input) => { saved = input; } });
    await act(async () => optionByText(el, "День").click());
    await setInput(el.querySelector<HTMLInputElement>("#entry-to")!, "2026-06-26");
    expect(el.querySelector('[data-testid="range-preview"]')!.textContent).toContain("Другие отсутствия в этих днях останутся на месте");
    await save(el);

    expect(saved).toMatchObject({ from: "2026-06-08", to: "2026-06-26", replaceAbsenceEntryId: longVacation.id });
    expect(saved).not.toHaveProperty("replaceAbsences");
  });

  // «С/По» шире отпуска уходят перезаписью: смены 23–26 июня, о которых панель
  // не знает, перепишутся. Подсказка говорила только про отпуск (H10).
  it("«По» за правимым отпуском: подсказка говорит, что остальные дни перепишутся", async () => {
    const el = await mount({ existing: longVacation, onSaveRange: async () => {} });
    await act(async () => optionByText(el, "День").click());
    const preview = () => el.querySelector('[data-testid="range-preview"]')!.textContent ?? "";
    // В пределах отпуска перезаписывать нечего — и подсказка об этом молчит.
    expect(preview()).not.toContain("Смены и дежурства в остальных днях перепишутся");

    await setInput(el.querySelector<HTMLInputElement>("#entry-to")!, "2026-06-26");
    expect(preview()).toContain("Смены и дежурства в остальных днях перепишутся");
  });

  // Админ хочет «Днём» только пятницу 12-го: суженные «С/По» — замена одного дня,
  // а не правка строки, которая перенесла бы в смену весь отпуск.
  it("один день из отпуска: суженные «С/По» шлют замену одного дня", async () => {
    let saved: NewEntryRangeInput | null = null;
    let single = 0;
    const el = await mount({
      existing: longVacation,
      onSave: async () => { single += 1; },
      onSaveRange: async (input) => { saved = input; },
    });
    await act(async () => optionByText(el, "День").click());
    await setInput(el.querySelector<HTMLInputElement>("#entry-from")!, "2026-06-12");
    await setInput(el.querySelector<HTMLInputElement>("#entry-to")!, "2026-06-12");
    expect(el.querySelector('[data-testid="range-preview"]')!.textContent).toContain("1 день отсутствия заменится");
    await save(el);

    expect(single).toBe(0);
    expect(saved).toMatchObject({ from: "2026-06-12", to: "2026-06-12", replaceAbsenceEntryId: longVacation.id });
  });

  it("обычная расстановка по умолчанию не заменяет, с галочкой — заменяет", async () => {
    const calls: NewEntryRangeInput[] = [];
    const el = await mount({ onSaveRange: async (input) => { calls.push(input); } });
    await setInput(el.querySelector<HTMLInputElement>("#entry-to")!, "2026-06-12");

    const box = replaceBox(el);
    expect(box?.checked).toBe(false);
    await save(el);
    expect(calls[0]!.replaceAbsences).toBeUndefined();

    await act(async () => box!.click());
    expect(el.querySelector('[data-testid="range-preview"]')!.textContent).toContain("уступят место новой записи");
    await save(el);
    expect(calls[1]).toMatchObject({ replaceAbsences: true, mode: "fill" });
  });
});
