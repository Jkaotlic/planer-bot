// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Employee } from "../../api/client";
import { FillWeekPanel } from "./AdminScheduleScreen";

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

function employee(overrides: Partial<Employee>): Employee {
  return {
    id: 1, displayName: "Аня", isAdmin: false, isActive: true, telegramUserId: null,
    birthDate: null, address: "Аня", preferredName: null,
    excludedFromAssignment: false, excludedFromSwaps: false,
    isObserver: false, selfScheduleEnabled: false, remindersEnabled: true,
    ...overrides,
  };
}

async function mount(employees: Employee[]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const panel = createElement(FillWeekPanel, {
    employees, templates: [], weekDates: [],
    onCancel: () => {}, onFilled: async () => {},
  });
  await act(async () => root!.render(createElement(AppRoot, null, panel)));
  return host;
}

// «Заполнить неделю» не фильтрует список работников — админ называет человека сам,
// намеренно (см. комментарий у PersonPicker в AdminScheduleScreen.tsx). Пометка «· вне
// назначений» — единственная защита от выбора по инерции того, кого бот сам никогда
// бы не поставил, и наблюдатель ровно такой (`takesPartInAssignment`), даже когда его
// сырая галочка `excludedFromAssignment` снята.
describe("FillWeekPanel — пометка «вне назначений»", () => {
  it("наблюдателя со снятой галочкой всё равно помечает", async () => {
    const el = await mount([employee({ displayName: "Игорь", isObserver: true, excludedFromAssignment: false })]);
    expect(el.textContent ?? "").toContain("Игорь · вне назначений");
  });

  it("обычного работника со снятой галочкой не помечает", async () => {
    const el = await mount([employee({ displayName: "Аня", isObserver: false, excludedFromAssignment: false })]);
    expect(el.textContent ?? "").toContain("Аня");
    expect(el.textContent ?? "").not.toContain("Аня · вне назначений");
  });

  it("работника с поднятой галочкой помечает как и раньше", async () => {
    const el = await mount([employee({ displayName: "Марк", isObserver: false, excludedFromAssignment: true })]);
    expect(el.textContent ?? "").toContain("Марк · вне назначений");
  });
});
