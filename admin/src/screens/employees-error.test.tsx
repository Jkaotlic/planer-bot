// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Employee } from "../api/client";
import { EmployeesScreen, refusalText } from "./EmployeesScreen";

/**
 * Зеркало теста мини-аппа (`miniapp/src/screens/admin/admin-employees-error.test.tsx`):
 * отказ на кнопку в строке рисовался общим блоком под заголовком экрана.
 *
 * В консоли строка компактнее (≈70px), но активных 28 плюс архив — список выше
 * окна, и у нижних строк ответ уходил за верхний край. Отказы настоящие:
 * «Архивировать» последнего админа → 400 `last_admin`, «✎ Имя» в занятое ФИО →
 * 409, «🔗 Ссылка» у архивного → 400 `archived`.
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Что вернёт отказавший сервер, и что из этого обязан прочитать человек. */
const REFUSAL_CODE = "last_admin";
const REFUSAL = refusalText(REFUSAL_CODE);

const EMPLOYEES: Employee[] = [
  { id: 1, displayName: "Аня Смирнова", isAdmin: true, isActive: true, telegramUserId: 10, birthDate: null, preferredName: null, address: "Аня", excludedFromAssignment: false, excludedFromSwaps: false },
  { id: 2, displayName: "Игорь Петров", isAdmin: false, isActive: true, telegramUserId: 11, birthDate: null, preferredName: null, address: "Игорь", excludedFromAssignment: false, excludedFromSwaps: false },
  { id: 3, displayName: "Марк Волков", isAdmin: false, isActive: true, telegramUserId: null, birthDate: null, preferredName: null, address: "Марк", excludedFromAssignment: false, excludedFromSwaps: false },
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

async function settle(times = 8) {
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
    root!.render(createElement(EmployeesScreen, { employees: EMPLOYEES, onChanged: async () => {}, onRestrictionsSaved: () => {} }));
  });
  await settle();
  return host;
}

/** Карточка строки — ближайший вверх `.employee-row-card`. */
function rowOf(button: HTMLElement): HTMLElement {
  const card = button.closest(".employee-row-card");
  if (!card) throw new Error("не нашёл карточку строки вокруг кнопки");
  return card as HTMLElement;
}

function archiveButtons(el: HTMLElement): HTMLButtonElement[] {
  return [...el.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === "Архивировать") as HTMLButtonElement[];
}

describe("отказ на действие в строке остаётся в этой строке (консоль)", () => {
  it("«Архивировать» получил отказ — причина написана в той же карточке", async () => {
    const el = await mount();
    const rows = archiveButtons(el);
    expect(rows.length).toBe(EMPLOYEES.length);

    vi.spyOn(apiClient, "archiveEmployee").mockRejectedValue(new Error(REFUSAL_CODE));

    const target = rows[rows.length - 1]!;
    await act(async () => target.click());
    await settle();

    expect(rowOf(target).textContent ?? "").toContain(REFUSAL);
  });

  it("отказ виден у нажатой строки и не появляется у соседней", async () => {
    const el = await mount();
    const rows = archiveButtons(el);

    vi.spyOn(apiClient, "archiveEmployee").mockRejectedValue(new Error(REFUSAL_CODE));

    const target = rows[rows.length - 1]!;
    const neighbour = rows[0]!;
    await act(async () => target.click());
    await settle();

    expect(rowOf(target).textContent ?? "").toContain(REFUSAL);
    expect(rowOf(neighbour).textContent ?? "").not.toContain(REFUSAL);
  });
});

describe("refusalText — код отказа превращается в фразу", () => {
  it("переводит коды, которые сервер отдаёт как есть", () => {
    expect(refusalText("last_admin")).toBe("Это последний админ — сначала назначь админом кого-то ещё.");
    expect(refusalText("archived")).toBe("Работник в архиве — сначала верни его из архива.");
    expect(refusalText("already_linked")).toBe("Телеграм уже привязан — ссылка больше не нужна.");
    expect(refusalText("not_found")).toBe("Такой записи больше нет — обнови экран.");
  });

  it("пропускает насквозь то, что сервер уже написал по-русски", () => {
    // Сторож тёзок отвечает готовой фразой — переводить её нечем и незачем.
    const taken = "Уже есть работник с ФИО «Смирнова Анна»";
    expect(refusalText(taken)).toBe(taken);
  });

  it("никогда не отдаёт пустоту вместо незнакомой причины", () => {
    expect(refusalText("что-то новое")).toBe("что-то новое");
  });
});
