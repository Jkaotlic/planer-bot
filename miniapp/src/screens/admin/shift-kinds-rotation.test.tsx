// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Employee } from "../../api/client";
import { AdminShiftKinds } from "./AdminShiftKinds";

/**
 * «Очередь идёт по дням / по неделям» — переключатель, который врал.
 *
 * Селект управляемый и берёт значение только из `queue`, а `queue` перечитывается
 * лишь при открытии карточки. Сохранение проходило (сервер отвечает 200 и пишет
 * `template_rotation_changed` в журнал), но состояние экрана не менялось — и React
 * возвращал селекту прежнее значение. Со стороны админа: выбрал «по неделям»,
 * селект прыгнул обратно на «по дням», значит не сохранилось. Он выбирает ещё раз.
 *
 * Плюс подпись «Следующие: …» приходит с сервера уже свёрнутой в слова по этой же
 * единице (`describeTurn`), так что без перечитывания очереди она тоже оставалась
 * дневной под недельной настройкой.
 *
 * Проверяется через DEV-мок — тот самый клиент, на котором работает `npm run dev`:
 * он честно запоминает единицу и отдаёт её следующим запросом.
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMPLOYEES: Employee[] = [
  { id: 1, displayName: "Аня Смирнова", isAdmin: false, isActive: true, telegramUserId: 10, birthDate: null, address: "Аня", preferredName: null },
  { id: 2, displayName: "Игорь Петров", isAdmin: false, isActive: true, telegramUserId: 11, birthDate: null, address: "Игорь", preferredName: null },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    // telegram-ui требует свой провайдер; проверяем мы то, что внутри.
    root!.render(
      createElement(AppRoot, null, createElement(AdminShiftKinds, { employees: EMPLOYEES, onClose: () => {} })),
    );
  });
  await settle();
  return host;
}

/** Мок отвечает через setTimeout — крутим таймеры, пока экран не догрузится. */
async function settle(times = 14) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

function rotationSelect(el: HTMLElement): HTMLSelectElement {
  const select = el.querySelector("select");
  if (!select) throw new Error("селекта «Очередь идёт» нет на экране");
  return select as HTMLSelectElement;
}

/** Меняет значение так, как это делает человек: React слушает событие change. */
async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

describe("«Очередь идёт» — выбранная единица остаётся выбранной", () => {
  it("после выбора «по неделям» селект показывает «по неделям», а не откатывается", async () => {
    const el = await mount();
    const head = el.querySelector("button[aria-expanded]") as HTMLButtonElement;
    await act(async () => head.click());
    await settle();

    const select = rotationSelect(el);
    expect(select.value).toBe("day");

    await choose(select, "week");

    // До починки здесь было "day": сервер сохранил, экран об этом не узнал.
    expect(rotationSelect(el).value).toBe("week");
  });

  it("сохранённая единица переживает закрытие и открытие карточки", async () => {
    const el = await mount();
    const head = () => el.querySelector("button[aria-expanded]") as HTMLButtonElement;
    await act(async () => head().click());
    await settle();

    await choose(rotationSelect(el), "week");

    await act(async () => head().click()); // свернуть
    await settle();
    await act(async () => head().click()); // развернуть заново
    await settle();

    expect(rotationSelect(el).value).toBe("week");
  });
});
