// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../../api/client";
import { AdminEmployeesScreen } from "./AdminEmployeesScreen";

/**
 * Тот же дефект, что был у «🔗 Ссылка», только с отказом вместо ссылки.
 *
 * Кнопки живут в строке работника, а `error` рисовался единственным блоком под
 * секцией «Новый работник» — в самом верху экрана. Замер в Chromium на 390px
 * (DEV-мок, 6 активных): блок ошибки на y≈304, кнопка «В архив» четвёртой строки
 * на y=1169 при высоте окна 844. С четвёртой строки и ниже ответ уже вне экрана;
 * в живой базе активных 28 плюс архив, шаг строки ≈216px — у нижних строк ошибка
 * оказывается на тысячи пикселей выше пальца.
 *
 * Отказы не выдуманные, все три достижимы с живого сервера:
 *   • «В архив» последнего админа → 400 `last_admin`;
 *   • «✎ Имя» в занятое ФИО → 409 (сторож тёзок);
 *   • «🔗 Ссылка» у архивного → 400 `archived` — а архив лежит ниже всех.
 * Во всех трёх случаях админ видел, что не изменилось ничего, и не видел почему.
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Что вернёт отказавший сервер — код, который клиент отдаёт как есть. */
const REFUSAL = "last_admin";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

/** Мок отвечает через setTimeout — крутим таймеры, пока экран не догрузится. */
async function settle(times = 14) {
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
    root!.render(createElement(AppRoot, null, createElement(AdminEmployeesScreen, null)));
  });
  await settle();
  return host;
}

/**
 * Карточка строки: ближайший вверх элемент, который несёт «Бот зовёт:» — эту
 * подпись рисует каждая строка и ровно одна. Поэтому первый такой предок — сама
 * карточка, а не секция со всеми строками сразу.
 */
function rowOf(button: HTMLElement): HTMLElement {
  let node: HTMLElement | null = button.parentElement;
  while (node && !(node.textContent ?? "").includes("Бот зовёт:")) node = node.parentElement;
  if (!node) throw new Error("не нашёл карточку строки вокруг кнопки");
  return node;
}

function archiveButtons(el: HTMLElement): HTMLButtonElement[] {
  return [...el.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === "В архив") as HTMLButtonElement[];
}

describe("отказ на действие в строке остаётся в этой строке", () => {
  it("«В архив» получил отказ — причина написана в той же карточке", async () => {
    const el = await mount();
    const rows = archiveButtons(el);
    expect(rows.length).toBeGreaterThan(1);

    vi.spyOn(apiClient, "archiveEmployee").mockRejectedValue(new Error(REFUSAL));

    // Последняя строка: именно там верхний блок ошибки уже вне экрана.
    const target = rows[rows.length - 1]!;
    await act(async () => target.click());
    await settle();

    expect(rowOf(target).textContent ?? "").toContain(REFUSAL);
  });

  it("отказ виден у нажатой строки и не появляется у соседней", async () => {
    const el = await mount();
    const rows = archiveButtons(el);
    expect(rows.length).toBeGreaterThan(1);

    vi.spyOn(apiClient, "archiveEmployee").mockRejectedValue(new Error(REFUSAL));

    const target = rows[rows.length - 1]!;
    const neighbour = rows[0]!;
    await act(async () => target.click());
    await settle();

    expect(rowOf(target).textContent ?? "").toContain(REFUSAL);
    expect(rowOf(neighbour).textContent ?? "").not.toContain(REFUSAL);
  });

  it("следующее действие в той же строке стирает прошлый отказ", async () => {
    const el = await mount();
    const rows = archiveButtons(el);
    const target = rows[rows.length - 1]!;

    const spy = vi.spyOn(apiClient, "archiveEmployee").mockRejectedValue(new Error(REFUSAL));
    await act(async () => target.click());
    await settle();
    expect(rowOf(target).textContent ?? "").toContain(REFUSAL);

    // Причина отпала (админ снял права с другого) — повтор проходит, надпись уходит.
    spy.mockResolvedValue(undefined);
    await act(async () => archiveButtons(el)[archiveButtons(el).length - 1]!.click());
    await settle();

    expect(el.textContent ?? "").not.toContain(REFUSAL);
  });
});
