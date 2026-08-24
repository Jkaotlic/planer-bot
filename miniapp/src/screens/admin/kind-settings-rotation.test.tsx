// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../../api/client";
import { AdminKindSettings } from "./AdminKindSettings";

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
 *
 * Экран переехал: очередь — свойство ВИДА смены, и с тех пор, как «Кто что
 * может» стал списком людей, живёт на «Видах смен».
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
      createElement(AppRoot, null, createElement(AdminKindSettings, { onClose: () => {} })),
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

describe("отказ на «Видах смен» остаётся в своей карточке", () => {
  it("не сохранившаяся очередь пишет причину в той карточке, где её меняли", async () => {
    const el = await mount();
    const heads = [...el.querySelectorAll("button[aria-expanded]")] as HTMLButtonElement[];
    expect(heads.length).toBeGreaterThan(1);

    // Нижняя карточка — та, до которой пришлось прокрутить: отказ, нарисованный
    // сверху экрана, для нажавшего здесь невидим.
    const head = heads[heads.length - 1]!;
    await act(async () => head.click());
    await settle();

    vi.spyOn(apiClient, "setRotationUnit").mockRejectedValue(new Error("Failed to fetch"));
    const select = el.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      select.value = "week";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    const error = [...el.querySelectorAll("div")].find(
      (d) => d.children.length === 0 && (d.textContent ?? "").includes("Failed to fetch"),
    );
    expect(error).toBeTruthy();
    expect((head.compareDocumentPosition(error!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    vi.restoreAllMocks();
  });
});
