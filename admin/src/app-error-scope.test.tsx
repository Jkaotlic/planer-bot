// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type RosterImportPreview } from "./api/client";
import { App } from "./App";

vi.mock("./lib/csv-encoding", () => ({
  readCsvFile: vi.fn(async () => ({ text: "csv-text", encoding: "utf-8" })),
}));

/**
 * Отказ одного запроса не должен уносить всю консоль.
 *
 * `error` рисуется вместо всего `main-column`, то есть вместо любого раздела.
 * Живой повод дёрнуть эту ветку — рестарт сервера при выкладке: `fetch` падает,
 * а админ в этот момент качает CSV или листает недели.
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

/** Мок отвечает через setTimeout — крутим таймеры, пока экран не догрузится. */
async function settle(times = 20) {
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
    root!.render(createElement(App));
  });
  await settle();
  return host;
}

function byText(el: HTMLElement, selector: string, text: string): HTMLElement {
  const found = [...el.querySelectorAll(selector)].find((node) => (node.textContent ?? "").trim() === text);
  if (!found) throw new Error(`не нашёл ${selector} с подписью «${text}»`);
  return found as HTMLElement;
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
  await settle();
}

describe("отказ одного запроса не уносит всю консоль", () => {
  it("упавшая подгрузка расписания оставляет доступными другие разделы", async () => {
    const el = await mount();
    expect(el.querySelector(".schedule-table")).not.toBeNull();

    vi.spyOn(apiClient, "getTeamSchedule").mockRejectedValue(new Error("Failed to fetch"));
    await click(el.querySelector("[aria-label='Следующая неделя']") as HTMLElement);
    expect(el.textContent ?? "").toContain("Failed to fetch");

    // «Работники» ходит своим запросом и к упавшему расписанию отношения не имеет.
    await click(byText(el, ".sidebar-nav-item", "Работники"));
    expect(el.querySelector(".employees-screen")).not.toBeNull();
  });

  it("упавшее расписание можно перезагрузить, не перезагружая страницу", async () => {
    const el = await mount();
    const failing = vi.spyOn(apiClient, "getTeamSchedule").mockRejectedValue(new Error("Failed to fetch"));
    await click(el.querySelector("[aria-label='Следующая неделя']") as HTMLElement);
    expect(el.querySelector(".schedule-table")).toBeNull();

    failing.mockRestore();
    await click(byText(el, "button", "Повторить"));

    expect(el.querySelector(".schedule-table")).not.toBeNull();
    expect(el.textContent ?? "").not.toContain("Failed to fetch");
  });

  it("отказ «Выгрузить CSV» не стирает расписание с экрана", async () => {
    const el = await mount();
    expect(el.querySelector(".schedule-table")).not.toBeNull();

    vi.spyOn(apiClient, "getRosterCsv").mockRejectedValue(new Error("Failed to fetch"));
    await click(byText(el, "button", "⬇ Выгрузить CSV"));

    // Скачивание не состоялось — сказать об этом надо, но расписание тут ни при чём.
    expect(el.textContent ?? "").toContain("Failed to fetch");
    expect(el.querySelector(".schedule-table")).not.toBeNull();
  });

  it("импорт CSV прошёл, а перезагрузка после него упала — отказ виден, а не потерян", async () => {
    const el = await mount();
    const preview: RosterImportPreview = {
      from: "2026-09-01", to: "2026-09-30", entryCount: 1,
      people: [{ csvName: "Волков Илья", suggestedEmployeeId: null }],
      unknowns: [], unknownsMessage: null, preservedCount: 0, existingCount: 0,
    };
    vi.spyOn(apiClient, "previewRosterImport").mockResolvedValue(preview);
    vi.spyOn(apiClient, "applyRosterImport").mockResolvedValue({
      employeesRenamed: 0, employeesCreated: 1, entriesInserted: 1, entriesDeleted: 0,
      cellsPreserved: 0, swapsExpired: 0, unknowns: [], notified: { delivered: 0, intended: 0 },
    });
    // Импорт сам прошёл; беда — в том, что случается СРАЗУ после него.
    vi.spyOn(apiClient, "getEmployees").mockRejectedValue(new Error("Не удалось обновить сотрудников"));

    const input = el.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["csv-text"], "roster.csv", { type: "text/csv" });
    const fileList = { 0: file, length: 1, item: (i: number) => (i === 0 ? file : null) } as unknown as FileList;
    await act(async () => {
      Object.defineProperty(input, "files", { value: fileList, configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    await click(byText(el, "button", "Применить CSV"));

    // Успех импорта не теряется...
    expect(el.textContent ?? "").toContain("CSV загружен");
    // ...и отказ перезагрузки после него — тоже, а не молчит.
    expect(el.textContent ?? "").toContain("Не удалось обновить сотрудников");
  });
});
