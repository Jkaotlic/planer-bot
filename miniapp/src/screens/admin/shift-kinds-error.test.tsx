// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Employee } from "../../api/client";
import { AdminShiftKinds } from "./AdminShiftKinds";

/**
 * «Кто что может» отдавал ВСЕ свои отказы наверх — в `error` родителя, который
 * рисуется над `ScreenScroll`. Экран при этом выше окна даже свёрнутым (замер на
 * 390×844: высота 970, последняя карточка на y=747), а развёрнутая карточка
 * добавляет по строке на каждого из двадцати восьми: отказ на переключатель в
 * такой карточке уходит за верхний край гарантированно.
 *
 * Плюс упавшая начальная загрузка оставляла вечный спиннер: `kinds` остаётся
 * null, ловца у эффекта нет, кнопки «повторить» не существует.
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMPLOYEES: Employee[] = [
  { id: 1, displayName: "Аня Смирнова", isAdmin: false, isActive: true, telegramUserId: 10, birthDate: null, preferredName: null, address: "Аня", excludedFromAssignment: false, excludedFromSwaps: false },
  { id: 2, displayName: "Игорь Петров", isAdmin: false, isActive: true, telegramUserId: 11, birthDate: null, preferredName: null, address: "Игорь", excludedFromAssignment: false, excludedFromSwaps: false },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 16) {
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
    root!.render(
      createElement(AppRoot, null, createElement(AdminShiftKinds, { employees: EMPLOYEES, onClose: () => {} })),
    );
  });
  await settle();
  return host;
}

function follows(node: Node, after: Node): boolean {
  return (after.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function errorNode(el: HTMLElement, text: string): HTMLElement | undefined {
  return [...el.querySelectorAll("div")].find(
    (d) => d.children.length === 0 && (d.textContent ?? "").includes(text),
  ) as HTMLElement | undefined;
}

describe("отказ в «Кто что может» остаётся в своей карточке", () => {
  it("не сохранившаяся очередь пишет причину в той карточке, где её меняли", async () => {
    const el = await mount();
    const heads = [...el.querySelectorAll("button[aria-expanded]")] as HTMLButtonElement[];
    expect(heads.length).toBeGreaterThan(1);

    // Нижняя карточка — та, до которой пришлось прокрутить.
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

    const error = errorNode(el, "Failed to fetch");
    expect(error).toBeTruthy();
    expect(follows(error!, head)).toBe(true);
  });

  it("упавшая загрузка экрана даёт «Повторить», а не вечный спиннер", async () => {
    const failing = vi.spyOn(apiClient, "getTemplateRoles").mockRejectedValue(new Error("Failed to fetch"));
    const el = await mount();

    expect(el.textContent ?? "").toContain("Failed to fetch");
    const retry = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Повторить");
    expect(retry).toBeTruthy();

    failing.mockRestore();
    await act(async () => retry!.click());
    await settle();

    expect(el.querySelectorAll("button[aria-expanded]").length).toBeGreaterThan(0);
  });
});
