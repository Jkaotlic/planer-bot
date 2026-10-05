// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Shift } from "./api/client";
import { App } from "./App";

/**
 * ОК/отказ из карточки записи в консоли: что видит админ, когда сервер ответил
 * «уже решено» (409) или «больничного уже нет» (404).
 */

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

async function settle(times = 12) {
  for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
}

const byText = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim() === text);

async function mountWithSick(afterRefresh: "approved" | "gone") {
  const employeeId = (await apiClient.getEmployees())[0]!.id;
  const sick = (from: string, pending: boolean): Shift => ({
    id: 99, date: from, start: null, end: null, endDate: null, category: "sick_leave", title: null,
    location: null, unrecognisedCode: null, templateId: null, employeeId, ...(pending ? { pending: true } : {}),
  });
  let reads = 0;
  vi.spyOn(apiClient, "getTeamSchedule").mockImplementation(async (from: string) => {
    reads += 1;
    if (reads === 1) return [sick(from, true)];
    return afterRefresh === "approved" ? [sick(from, false)] : [];
  });
  vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(App)); });
  await settle();
  const chip = host.querySelector<HTMLButtonElement>(".entry-chip.is-pending");
  expect(chip, "ждущий чип не нарисован").not.toBeNull();
  await act(async () => chip!.click());
  return host;
}

describe("решение из карточки записи", () => {
  it("409: ошибка остаётся в панели, а кнопок у уже решённой записи больше нет", async () => {
    const el = await mountWithSick("approved");
    vi.spyOn(apiClient, "approveSickLeave").mockRejectedValue(new Error("Уже подтвердил(а) Игорь"));
    await act(async () => byText(el, "✅ ОК")!.click());
    await settle();
    expect(el.querySelector(".error-text")?.textContent).toContain("Уже подтвердил(а) Игорь");
    expect(byText(el, "✅ ОК")).toBeUndefined();
  });

  it("404: запись снята — панель закрыта, текст на экране", async () => {
    const el = await mountWithSick("gone");
    vi.spyOn(apiClient, "rejectSickLeave").mockRejectedValue(new Error("Больничного уже нет"));
    await act(async () => byText(el, "❌ Отклонить")!.click());
    await act(async () => byText(el, "Да, отклонить")!.click());
    await settle();
    expect(el.querySelector(".panel-pending")).toBeNull();
    expect(el.querySelector(".roster-notice-error")?.textContent).toContain("Больничного уже нет");
  });

  it("решение принято, а расписание не перечиталось — говорит об этом, а не «не получилось»", async () => {
    const el = await mountWithSick("approved");
    vi.spyOn(apiClient, "approveSickLeave").mockResolvedValue(undefined);
    vi.mocked(apiClient.getTeamSchedule).mockRejectedValue(new Error("сеть"));
    await act(async () => byText(el, "✅ ОК")!.click());
    await settle();
    expect(el.querySelector(".roster-notice-error")?.textContent).toContain("Решение принято");
  });

  it("открытие «На подтверждение» перечитывает метку", async () => {
    const el = await mountWithSick("approved");
    const spy = vi.mocked(apiClient.getSickApprovals);
    const before = spy.mock.calls.length;
    const nav = [...el.querySelectorAll<HTMLButtonElement>(".sidebar-nav-item")].find((b) => (b.textContent ?? "").includes("На подтверждение"))!;
    await act(async () => nav.click());
    await settle(3);
    // Экран читает список сам, метка — своим запросом: минимум два вызова.
    expect(spy.mock.calls.length - before).toBeGreaterThanOrEqual(2);
  });
});
