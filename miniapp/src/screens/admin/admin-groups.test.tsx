// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Employee, type RecipientGroupView } from "../../api/client";
import { AdminGroups } from "./AdminGroups";

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

async function mount(groups: RecipientGroupView[]) {
  vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue(groups);
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue(PEOPLE);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(AdminGroups))); });
  await settle();
  return host;
}

function byText(el: HTMLElement, text: string): HTMLElement {
  const found = [...el.querySelectorAll<HTMLElement>("button")].find((n) => (n.textContent ?? "").trim().startsWith(text));
  if (!found) throw new Error(`не нашёл «${text}»`);
  return found;
}

function checkboxFor(el: HTMLElement, name: string): HTMLInputElement {
  const row = [...el.querySelectorAll<HTMLElement>("label")].find((r) => (r.textContent ?? "").includes(name));
  const box = row?.querySelector<HTMLInputElement>("input[type=checkbox]");
  if (!box) throw new Error(`не нашёл галочку «${name}»`);
  return box;
}

async function type(field: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AdminGroups", () => {
  it("показывает группы с числом людей", async () => {
    const el = await mount([{ id: 1, name: "ЧИП 5-й этаж", memberIds: [2, 3] }]);
    expect(el.textContent).toContain("ЧИП 5-й этаж");
    expect(el.textContent).toContain("2 чел.");
  });

  it("новая группа: имя + галочки → createRecipientGroup", async () => {
    const create = vi.spyOn(apiClient, "createRecipientGroup").mockResolvedValue({ id: 1, name: "ЧИП 32 этаж", memberIds: [3] });
    const el = await mount([]);
    await act(async () => byText(el, "+ Новая группа").click());
    await act(async () => type(el.querySelector<HTMLInputElement>("input[name=group-name]")!, "ЧИП 32 этаж"));
    await act(async () => checkboxFor(el, "Марк").click());
    await act(async () => byText(el, "Сохранить").click());
    await settle();
    expect(create).toHaveBeenCalledWith({ name: "ЧИП 32 этаж", memberIds: [3] });
  });

  it("правка существующей: снятая галочка уходит в saveRecipientGroup", async () => {
    const save = vi.spyOn(apiClient, "saveRecipientGroup").mockResolvedValue({ id: 1, name: "A", memberIds: [2] });
    const el = await mount([{ id: 1, name: "A", memberIds: [2, 3] }]);
    await act(async () => byText(el, "A").click());
    await act(async () => checkboxFor(el, "Марк").click());
    await act(async () => byText(el, "Сохранить").click());
    await settle();
    expect(save).toHaveBeenCalledWith(1, { name: "A", memberIds: [2] });
  });

  it("ошибка сервера видна текстом", async () => {
    vi.spyOn(apiClient, "createRecipientGroup").mockRejectedValue(new Error("Группа с таким названием уже есть."));
    const el = await mount([]);
    await act(async () => byText(el, "+ Новая группа").click());
    await act(async () => type(el.querySelector<HTMLInputElement>("input[name=group-name]")!, "A"));
    await act(async () => byText(el, "Сохранить").click());
    await settle();
    expect(el.textContent).toContain("Группа с таким названием уже есть.");
  });

  it("уволенные в список выбора не попадают", async () => {
    const el = await mount([]);
    await act(async () => byText(el, "+ Новая группа").click());
    expect(el.textContent).not.toContain("Лена");
  });

  it("удаление группы: второй тап подтверждает → deleteRecipientGroup", async () => {
    const del = vi.spyOn(apiClient, "deleteRecipientGroup").mockResolvedValue();
    const el = await mount([{ id: 7, name: "A", memberIds: [1] }]);
    await act(async () => byText(el, "A").click());
    await act(async () => byText(el, "Удалить группу").click());
    await act(async () => byText(el, "Да, удалить").click());
    await settle();
    expect(del).toHaveBeenCalledWith(7);
  });
});
