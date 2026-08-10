// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Shift, Template } from "../api/client";
import { ProposeSwapScreen, type ProposeSwapScreenProps } from "./ProposeSwapScreen";

/**
 * Экран обмена, каким он был до 2026-08-03: 93 строки чужих смен за всю неделю,
 * у каждой видно имя и время — но не дату, а выбранного человека видно только на
 * кнопке под всеми строками. Замер по живой базе: 20 человек, один встречается в
 * списке пять раз в разных местах.
 *
 * Теперь меняться можно только внутри одного дня, поэтому день задан отдаваемой
 * сменой, а на экране ищут человека. Тест держит ровно это: список — люди одного
 * дня, поиск фильтрует по имени, выбор виден на самой строке, а пустота названа
 * словами, а не показана пустым списком.
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = "2026-09-10";
const shift = (over: Partial<Shift> & { id: number }): Shift =>
  ({
    date: DAY,
    endDate: null,
    start: "09:00",
    end: "18:00",
    category: "shift",
    title: "День",
    templateId: 2,
    employeeId: 2,
    employeeName: "Волков Илья",
    location: null,
    note: null,
    unrecognisedCode: null,
    ...over,
  }) as Shift;

const MINE = shift({
  id: 1,
  employeeId: 1,
  employeeName: undefined,
  start: "15:00",
  end: "23:00",
  templateId: 4,
  title: "Вечер",
});

const CANDIDATES = [
  shift({ id: 2, employeeId: 2, employeeName: "Волков Илья" }),
  shift({ id: 3, employeeId: 3, employeeName: "Яшин Пётр", start: "08:00", end: "17:00", templateId: 1, title: "Утро" }),
];

/** Длинный список — такой, на котором поиск и нужен: на живых данных их до 17. */
const MANY = [
  ...CANDIDATES,
  shift({ id: 4, employeeId: 4, employeeName: "Гордеев Лев", start: "11:00", end: "20:00", templateId: 3, title: "Вечер" }),
  shift({ id: 5, employeeId: 5, employeeName: "Мальцев Ким", start: "08:00", end: "17:00", templateId: 1, title: "Утро" }),
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(props: Partial<ProposeSwapScreenProps> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    // telegram-ui требует свой провайдер; проверяем мы то, что внутри.
    root!.render(
      createElement(
        AppRoot,
        null,
        createElement(ProposeSwapScreen, {
          fromShift: MINE,
          candidates: CANDIDATES,
          templates: [],
          sameKindCount: 0,
          loading: false,
          loadError: null,
          onCancel: () => {},
          onConfirm: async () => {},
          ...props,
        }),
      ),
    );
  });
  return host;
}

function rows(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll("[data-testid='swap-candidate']")] as HTMLElement[];
}

async function type(el: HTMLElement, value: string) {
  const search = el.querySelector("input[type='search']") as HTMLInputElement;
  expect(search).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(search, value);
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("экран обмена", () => {
  it("показывает коллег того же дня с их временем", async () => {
    const el = await mount();
    const texts = rows(el).map((r) => r.textContent ?? "");
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain("Волков Илья");
    expect(texts[0]).toContain("09:00");
  });

  it("поиск по имени оставляет только совпавших", async () => {
    const el = await mount({ candidates: MANY });
    await type(el, "яш");
    const texts = rows(el).map((r) => r.textContent ?? "");
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("Яшин Пётр");
  });

  // На двух-трёх строках поиск — лишняя строка на маленьком экране: их видно и так.
  it("на коротком списке поиска нет, на длинном есть", async () => {
    const short = await mount();
    expect(short.querySelector("input[type='search']")).toBeNull();
    await act(async () => root!.unmount());
    host!.remove();

    const long = await mount({ candidates: MANY });
    expect(long.querySelector("input[type='search']")).toBeTruthy();
  });

  it("выбор виден на самой строке, а не только на кнопке внизу", async () => {
    const el = await mount();
    await act(async () => rows(el)[0]!.click());
    expect(rows(el)[0]!.textContent).toContain("Выбрано");
  });

  it("говорит, сколько человек в этот день на такой же смене", async () => {
    const el = await mount({ sameKindCount: 12 });
    expect(el.textContent).toContain("Ещё 12 человек");
  });

  it("когда меняться не с кем — объясняет, а не молчит пустым списком", async () => {
    const el = await mount({ candidates: [], sameKindCount: 3 });
    expect(el.textContent).toContain("меняться не с кем");
    expect(rows(el)).toEqual([]);
  });

  it("пока грузится — не врёт, что меняться не с кем", async () => {
    const el = await mount({ candidates: [], sameKindCount: 0, loading: true });
    expect(el.textContent).not.toContain("меняться не с кем");
  });
});

/**
 * Экран обязан называть вид записи: с 2026-08-10 отдать можно и дежурство, и
 * «10:00–19:00» без названия не говорит, Поклонка это или Вавилова.
 *
 * Ключевой кейс — запись БЕЗ своей подписи: подпись из `title` экран показывал
 * и раньше, а имя пресета — нет, и на дежурстве из консоли это разница между
 * «Дежурство · Вавилова 19» и молчанием.
 */
const V19: Template = {
  id: 8, sortOrder: 3, name: "Дежурство · Вавилова 19", start: "10:00", end: "19:00",
  fridayStart: "10:00", fridayEnd: "19:00", isLate: false, sendReminder: false,
  category: "duty", location: "Вавилова 19", accent: "teal",
};

describe("экран предложения называет вид записи", () => {
  it("и у отдаваемой, и у чужой", async () => {
    const el = await mount({
      fromShift: shift({ id: 1, employeeId: 1, employeeName: undefined, category: "duty", title: "Дежурство · Поклонка", templateId: 7 }),
      candidates: [
        shift({ id: 2, employeeId: 2, employeeName: "Игорь", category: "duty", title: null, templateId: V19.id, start: "10:00", end: "19:00" }),
      ],
      templates: [V19],
    });
    expect(el.textContent).toContain("Дежурство · Поклонка");
    expect(el.textContent).toContain("Дежурство · Вавилова 19");
  });
});
