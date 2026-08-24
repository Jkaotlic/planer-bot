// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../../api/client";
import { AdminScheduleScreen } from "./AdminScheduleScreen";

/**
 * Упавшая подгрузка недели врала двумя разными способами, и оба молча.
 *
 * Переход на другую неделю: эффект ловит отказ в `error` наверху экрана, но
 * `shifts` остаётся от ПРЕЖНЕЙ недели, а выбранный день уже новый — ни одна
 * запись не совпадает, и экран пишет «В этот день пока ничего не запланировано».
 * То есть сообщает, что день пуст, хотя просто не смог его прочитать.
 *
 * Любая перезагрузка через `loadWeek` (после сохранения записи, «Заполнить
 * неделю», импорта CSV) сначала ставит `shifts = null`, а
 * ловца у неё нет вовсе: отказ оставлял вечный спиннер, и объяснения к нему не
 * было нигде — у формы записи он прилетал в `formError` уже закрытой формы.
 *
 * Тот же класс, что и в консоли (`aaf72d2`): беда одного запроса обязана быть
 * видна и обратима, а не притворяться пустотой или загрузкой.
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
  vi.restoreAllMocks();
});

async function settle(times = 24) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminScheduleScreen)));
  });
  await settle();
  return host;
}

function button(el: HTMLElement, label: string): HTMLElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label);
  if (!found) throw new Error(`нет кнопки «${label}»`);
  return found as HTMLElement;
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
  await settle();
}

const EMPTY_DAY = "В этот день пока ничего не запланировано";

describe("упавшая неделя в мобильной админке видна и обратима", () => {
  it("переход на неделю, которая не загрузилась, не выдаёт день за пустой", async () => {
    const el = await mount();

    const failing = vi.spyOn(apiClient, "getTeamSchedule").mockRejectedValue(new Error("Failed to fetch"));
    await click(el.querySelector("[aria-label='Следующая неделя']") as HTMLElement);

    expect(el.textContent ?? "").toContain("Failed to fetch");
    expect(el.textContent ?? "").not.toContain(EMPTY_DAY);

    failing.mockRestore();
    await click(button(el, "Повторить"));
    expect(el.textContent ?? "").not.toContain("Failed to fetch");
  });

  it("перезагрузка после «Заполнить неделю» не оставляет вечный спиннер", async () => {
    const el = await mount();

    // «Заполнить неделю» — один из зовущих `loadWeek`; раньше эту же ветку
    // проверяли кнопкой «Распределить честно», которой больше нет.
    await click(button(el, "📅 Заполнить неделю"));
    const weekSelect = el.querySelector("select") as HTMLSelectElement;
    const preset = [...weekSelect.options].find((o) => o.value.startsWith("p:"))!;
    await act(async () => {
      weekSelect.value = preset.value;
      weekSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    vi.spyOn(apiClient, "createEntries").mockResolvedValue({ created: 5, notified: { delivered: 0, intended: 0 } });
    vi.spyOn(apiClient, "getTeamSchedule").mockRejectedValue(new Error("Failed to fetch"));
    const fill = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith("Заполнить ("))!;
    await click(fill as HTMLElement);

    // До починки здесь висел спиннер: `loadWeek` снимает записи и ловца не имеет.
    expect(button(el, "Повторить")).toBeTruthy();
  });
});
