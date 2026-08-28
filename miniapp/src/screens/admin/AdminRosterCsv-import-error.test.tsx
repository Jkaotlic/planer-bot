// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Employee, type RosterImportPreview } from "../../api/client";
import { AdminRosterCsv } from "./AdminRosterCsv";

/**
 * «Импорт прошёл, а обновить список не удалось» терялось молча.
 *
 * `apply()` закрывает панель (`setState(null)`) и показывает успех ДО того, как
 * ждёт `onImported()` — так и должно быть, импорт правда прошёл. Но если САМА
 * перезагрузка (`reloadAfterImport` в AdminScheduleScreen — два обычных GET)
 * упала, catch пытался записать ошибку в уже нулевое состояние:
 * `setState(current => current ? {...} : current)` на `current === null` не
 * делает ничего, и админ не узнаёт, что список мог остаться старым.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMPLOYEES: Employee[] = [
  { id: 1, displayName: "Волков Илья", isAdmin: false, isActive: true, telegramUserId: 1, birthDate: null, address: "Волков Илья", preferredName: null, excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false, remindersEnabled: true },
];

const PREVIEW: RosterImportPreview = {
  from: "2026-09-01",
  to: "2026-09-30",
  entryCount: 1,
  people: [{ csvName: "Волков Илья", suggestedEmployeeId: 1 }],
  unknowns: [],
  unknownsMessage: null,
  preservedCount: 0,
  existingCount: 0,
};

vi.mock("../../lib/csv-encoding", () => ({
  readCsvFile: vi.fn(async () => ({ text: "csv-text", encoding: "utf-8" })),
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function mount(props: Partial<Parameters<typeof AdminRosterCsv>[0]> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(
        AppRoot,
        null,
        createElement(AdminRosterCsv, {
          employees: EMPLOYEES,
          today: "2026-09-01",
          onError: () => {},
          onNotice: () => {},
          onImported: () => {},
          onClose: () => {},
          ...props,
        }),
      ),
    );
  });
  return host;
}

async function settle(times = 10) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function uploadAndPreview(el: HTMLElement) {
  vi.spyOn(apiClient, "previewRosterImport").mockResolvedValue(PREVIEW);
  const input = el.querySelector("input[type='file']") as HTMLInputElement;
  const file = new File(["csv-text"], "roster.csv", { type: "text/csv" });
  // jsdom не даёт DataTransfer — подменяем `files` напрямую псевдо-FileList'ом.
  const fileList = { 0: file, length: 1, item: (i: number) => (i === 0 ? file : null) } as unknown as FileList;
  await act(async () => {
    Object.defineProperty(input, "files", { value: fileList, configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

function applyButton(el: HTMLElement): HTMLButtonElement {
  return [...el.querySelectorAll("button")].find((b) => /Применить|Перезаписать/.test(b.textContent ?? "")) as HTMLButtonElement;
}

describe("AdminRosterCsv — отказ перезагрузки после импорта", () => {
  it("сообщает об отказе onImported() через onError, а не молчит", async () => {
    const onError = vi.fn();
    const onNotice = vi.fn();
    const el = await mount({
      onError,
      onNotice,
      onImported: () => Promise.reject(new Error("Не удалось загрузить неделю")),
    });
    await uploadAndPreview(el);
    vi.spyOn(apiClient, "applyRosterImport").mockResolvedValue({
      employeesRenamed: 1, employeesCreated: 0, entriesInserted: 1, entriesDeleted: 0,
      cellsPreserved: 0, swapsExpired: 0, unknowns: [], notified: { delivered: 0, intended: 0 },
    });

    await act(async () => applyButton(el).click());
    await settle();

    expect(onNotice, "успех импорта всё равно должен быть сказан").toHaveBeenCalled();
    expect(onError, "а отказ перезагрузки — не потерян").toHaveBeenCalledWith(expect.stringContaining("Не удалось загрузить неделю"));
  });
});
