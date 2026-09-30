// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Employee, type RecipientGroupView } from "../api/client";
import { GroupsScreen } from "./GroupsScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PEOPLE = [
  { id: 1, displayName: "Аня", isActive: true },
  { id: 2, displayName: "Игорь", isActive: true },
  { id: 3, displayName: "Марк", isActive: true },
  { id: 4, displayName: "Лена", isActive: false },
] as unknown as Employee[];

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

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(GroupsScreen, { employees: PEOPLE })); });
  await settle();
  return host;
}

async function mount(groups: RecipientGroupView[]) {
  vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue(groups);
  return render();
}

function byText(el: HTMLElement, text: string): HTMLElement {
  const found = [...el.querySelectorAll<HTMLElement>("button")].find((n) => (n.textContent ?? "").trim().startsWith(text));
  if (!found) throw new Error(`не нашёл «${text}»`);
  return found;
}

/** Человек в составе — кнопка-«таблетка» с aria-pressed, как выбор видов смен у чек-листа. */
function personChip(el: HTMLElement, name: string): HTMLElement {
  const chip = [...el.querySelectorAll<HTMLElement>("button.category-option")].find((n) => (n.textContent ?? "").trim() === name);
  if (!chip) throw new Error(`не нашёл «${name}»`);
  return chip;
}

async function type(field: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

const nameField = (el: HTMLElement) => el.querySelector<HTMLInputElement>("input[name=group-name]")!;

describe("GroupsScreen", () => {
  it("показывает группы с числом людей", async () => {
    const el = await mount([{ id: 1, name: "ЧИП 5-й этаж", memberIds: [2, 3] }]);
    expect(el.textContent).toContain("ЧИП 5-й этаж");
    expect(el.textContent).toContain("2 чел.");
  });

  it("новая группа: имя + выбор людей → createRecipientGroup", async () => {
    const create = vi.spyOn(apiClient, "createRecipientGroup").mockResolvedValue({ id: 1, name: "ЧИП 32 этаж", memberIds: [3] });
    const el = await mount([]);
    await act(async () => byText(el, "+ Новая группа").click());
    await act(async () => type(nameField(el), "ЧИП 32 этаж"));
    await act(async () => personChip(el, "Марк").click());
    expect(personChip(el, "Марк").getAttribute("aria-pressed")).toBe("true");
    await act(async () => byText(el, "Сохранить").click());
    await settle();
    expect(create).toHaveBeenCalledWith({ name: "ЧИП 32 этаж", memberIds: [3] });
  });

  it("правка существующей: снятый человек уходит в saveRecipientGroup", async () => {
    const save = vi.spyOn(apiClient, "saveRecipientGroup").mockResolvedValue({ id: 1, name: "A", memberIds: [2] });
    const el = await mount([{ id: 1, name: "A", memberIds: [2, 3] }]);
    await act(async () => byText(el, "A").click());
    await act(async () => personChip(el, "Марк").click());
    await act(async () => byText(el, "Сохранить").click());
    await settle();
    expect(save).toHaveBeenCalledWith(1, { name: "A", memberIds: [2] });
  });

  it("переименование без смены состава шлёт только имя", async () => {
    const save = vi.spyOn(apiClient, "saveRecipientGroup").mockResolvedValue({ id: 1, name: "B", memberIds: [2, 3] });
    const el = await mount([{ id: 1, name: "A", memberIds: [2, 3] }]);
    await act(async () => byText(el, "A").click());
    await act(async () => type(nameField(el), "B"));
    await act(async () => byText(el, "Сохранить").click());
    await settle();
    expect(save).toHaveBeenCalledWith(1, { name: "B" });
  });

  it("ошибка сохранения — внутри открытого редактора", async () => {
    vi.spyOn(apiClient, "createRecipientGroup").mockRejectedValue(new Error("Группа с таким названием уже есть."));
    const el = await mount([]);
    await act(async () => byText(el, "+ Новая группа").click());
    await act(async () => type(nameField(el), "A"));
    await act(async () => byText(el, "Сохранить").click());
    await settle();
    const editor = nameField(el).closest("[data-group-editor]");
    expect(editor?.textContent).toContain("Группа с таким названием уже есть.");
  });

  it("не загрузилось — только ошибка и «Повторить», без «+ Новая группа»", async () => {
    const get = vi.spyOn(apiClient, "getRecipientGroups").mockRejectedValueOnce(new Error("Нет связи."));
    const el = await render();
    expect(el.textContent).toContain("Нет связи.");
    expect(el.textContent).not.toContain("+ Новая группа");
    expect(el.textContent).not.toContain("Групп пока нет");
    get.mockResolvedValue([]);
    await act(async () => byText(el, "Повторить").click());
    await settle();
    expect(el.textContent).toContain("+ Новая группа");
    expect(el.textContent).not.toContain("Нет связи.");
  });

  it("удаление спрашивает про сохранённое имя, а не про набранное", async () => {
    const el = await mount([{ id: 7, name: "A", memberIds: [1] }]);
    await act(async () => byText(el, "A").click());
    await act(async () => type(nameField(el), "Черновик"));
    await act(async () => byText(el, "Удалить группу").click());
    expect(el.textContent).toContain("Удалить «A»?");
  });

  it("уволенные в список выбора не попадают", async () => {
    const el = await mount([]);
    await act(async () => byText(el, "+ Новая группа").click());
    expect(el.textContent).not.toContain("Лена");
  });

  it("удаление группы: второй клик подтверждает → deleteRecipientGroup, потом перечитывает", async () => {
    const del = vi.spyOn(apiClient, "deleteRecipientGroup").mockResolvedValue();
    const el = await mount([{ id: 7, name: "A", memberIds: [1] }]);
    const get = vi.mocked(apiClient.getRecipientGroups);
    const before = get.mock.calls.length;
    await act(async () => byText(el, "A").click());
    await act(async () => byText(el, "Удалить группу").click());
    await act(async () => byText(el, "Да, удалить").click());
    await settle();
    expect(del).toHaveBeenCalledWith(7);
    expect(get.mock.calls.length).toBe(before + 1);
    expect(el.querySelector("[data-group-editor]")).toBeNull();
  });
});
