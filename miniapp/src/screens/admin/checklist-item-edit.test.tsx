// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Checklist } from "../../api/client";
import { AdminChecklists } from "./AdminChecklists";

/**
 * Паритет с консолью: пункт чек-листа в мини-аппе правится (название и
 * пояснение) и переставляется. Раньше опечатку чинили «убрать и добавить», и
 * пункт уезжал в конец — а порядок пунктов и есть порядок обхода в сообщении.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIST: Checklist = {
  id: 5, name: "Обход 47-го", note: null, docUrl: null, docName: null, hasDoc: false,
  items: [
    { id: 11, title: "Свет", note: null },
    { id: 12, title: "Окна", note: "Все три этажа" },
    { id: 13, title: "Двери", note: null },
  ],
  templateIds: [],
};

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
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

async function mount() {
  vi.spyOn(apiClient, "getChecklists").mockResolvedValue([structuredClone(LIST)]);
  vi.spyOn(apiClient, "getTemplates").mockResolvedValue([]);
  vi.spyOn(apiClient, "getChecklistDay").mockResolvedValue({ date: "2026-09-28", people: [] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(AdminChecklists))); });
  await settle();
  const head = host.querySelector("button[aria-expanded]") as HTMLButtonElement;
  await act(async () => head.click());
  await settle();
  return host;
}

const byLabel = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)];

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);
  if (!found) throw new Error(`не нашёл кнопку «${text}»`);
  return found;
}

async function click(b: HTMLElement) {
  await act(async () => { b.click(); });
  await settle();
}

async function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("мини-апп: перестановка пунктов чек-листа", () => {
  it("↑ поднимает пункт на одну позицию, ↓ опускает — тем пунктом, что нажат", async () => {
    const reorder = vi.spyOn(apiClient, "reorderChecklistItem").mockResolvedValue(LIST);
    const el = await mount();

    await click(byLabel(el, "Выше")[1]!);
    expect(reorder).toHaveBeenLastCalledWith(12, 0);

    await click(byLabel(el, "Ниже")[1]!);
    expect(reorder).toHaveBeenLastCalledWith(12, 2);
    expect(reorder).toHaveBeenCalledTimes(2);
  });

  it("первый не поднять, последний не опустить", async () => {
    vi.spyOn(apiClient, "reorderChecklistItem").mockResolvedValue(LIST);
    const el = await mount();
    const up = byLabel(el, "Выше");
    const down = byLabel(el, "Ниже");
    expect(up[0]!.disabled).toBe(true);
    expect(up[1]!.disabled).toBe(false);
    expect(down[2]!.disabled).toBe(true);
    expect(down[1]!.disabled).toBe(false);
  });
});

describe("мини-апп: правка пункта чек-листа", () => {
  it("✎ → новое название → «Сохранить» шлёт только название этого пункта", async () => {
    const update = vi.spyOn(apiClient, "updateChecklistItem").mockResolvedValue(LIST);
    const el = await mount();

    await click(byLabel(el, "Изменить пункт")[1]!);
    const title = [...el.querySelectorAll<HTMLInputElement>("input")].find((i) => i.value === "Окна")!;
    await typeInto(title, "Окна и форточки");
    await click(buttonByText(el, "Сохранить"));

    expect(update).toHaveBeenCalledTimes(1);
    // Нетронутое пояснение не уходит: иначе форма, открытая до чужой правки,
    // затёрла бы его старым текстом.
    expect(update).toHaveBeenCalledWith(12, { title: "Окна и форточки" });
    // Форма закрылась — строка пункта снова на месте.
    expect(el.querySelector('textarea[placeholder="Необязательно"]')).toBeNull();
  });

  it("стёртое пояснение уходит как null, название не трогается", async () => {
    const update = vi.spyOn(apiClient, "updateChecklistItem").mockResolvedValue(LIST);
    const el = await mount();

    await click(byLabel(el, "Изменить пункт")[1]!);
    await typeInto(el.querySelector<HTMLTextAreaElement>('textarea[placeholder="Необязательно"]')!, "  ");
    await click(buttonByText(el, "Сохранить"));

    expect(update).toHaveBeenCalledWith(12, { note: null });
  });

  it("без изменений «Сохранить» не активна, «Отмена» закрывает без запроса", async () => {
    const update = vi.spyOn(apiClient, "updateChecklistItem").mockResolvedValue(LIST);
    const el = await mount();

    await click(byLabel(el, "Изменить пункт")[0]!);
    expect(buttonByText(el, "Сохранить").disabled).toBe(true);
    await click(buttonByText(el, "Отмена"));
    expect(update).not.toHaveBeenCalled();
    expect(el.querySelector('textarea[placeholder="Необязательно"]')).toBeNull();
  });
});
