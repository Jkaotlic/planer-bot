// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Employee } from "../../api/client";
import { AdminEmployeesScreen } from "./AdminEmployeesScreen";

/**
 * Сверка морд 2026-10-06: у архивного работника мини-апп показывал «🔗 Ссылка»,
 * консоль — нет. Права консоль: сервер ссылку архивному не выдаёт никогда
 * (`POST /api/admin/employees/:id/invite` → 400 `archived` — привязать архивную
 * запись нельзя), так что кнопка в мини-аппе всегда кончалась отказом «сначала
 * верни из архива». Кнопка, которая не может сработать, — не действие, а шум.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function employee(patch: Partial<Employee>): Employee {
  return {
    id: 1, displayName: "Аня", isAdmin: false, isActive: true, telegramUserId: null,
    birthDate: null, address: "Аня", preferredName: null,
    excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false,
    selfScheduleEnabled: false, remindersEnabled: true,
    ...patch,
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 10) {
  for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

/** Карточка строки — ближайший предок с ровно одним «Бот зовёт:». */
function rowByName(el: HTMLElement, name: string): HTMLElement {
  const label = [...el.querySelectorAll("*")].find((n) => n.children.length === 0 && (n.textContent ?? "").trim() === name);
  let node: HTMLElement | null = (label as HTMLElement | undefined) ?? null;
  while (node && !(node.textContent ?? "").includes("Бот зовёт:")) node = node.parentElement;
  if (!node) throw new Error(`нет строки «${name}»`);
  return node;
}

describe("«🔗 Ссылка» у архивного (мини-апп)", () => {
  it("у архивного без телеграма кнопки нет; у активного без телеграма — есть", async () => {
    vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([
      employee({ id: 1, displayName: "Игорь", address: "Игорь", isAdmin: true, telegramUserId: 101 }),
      employee({ id: 2, displayName: "Новичок Никита", address: "Никита" }),
      employee({ id: 3, displayName: "Ушедший Марк", address: "Марк", isActive: false }),
    ]);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(AppRoot, null, createElement(AdminEmployeesScreen, null))); });
    await settle();

    const show = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").startsWith("Показать"));
    if (!show) throw new Error("нет кнопки раскрытия архива");
    await act(async () => show.click());
    await settle();

    expect(rowByName(host, "Новичок Никита").textContent).toContain("🔗 Ссылка");
    const archived = rowByName(host, "Ушедший Марк");
    expect(archived.textContent).toContain("Вернуть");
    expect(archived.textContent).not.toContain("🔗 Ссылка");
  });
});
