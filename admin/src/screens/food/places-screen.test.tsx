// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_DISH_NAME, FOOD_MENU_FULL_HINT } from "@planer/shared";
import { apiClient } from "../../api/client";
import { button, click, maybeButton, mount, type, unmount, waitFor } from "./food-test-kit";
import { PlaceEditor, PlacesScreen } from "./PlacesScreen";

afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
});

const DODO = { id: 1, name: "Додо", menu: [{ id: 11, name: "Пицца", price: 1200 }, { id: 12, name: "Суп", price: 300 }] };
const field = (el: HTMLElement, label: string) => el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const editorProps = (place: typeof DODO | null = null) => ({ place, onSaved: vi.fn(), onCancel: vi.fn(), onAuthRequired: vi.fn() });

describe("консоль: места — список", () => {
  it("место с меню строкой shared — деньги как везде", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([DODO]);
    const el = await mount(PlacesScreen, { onBack: vi.fn(), onAuthRequired: vi.fn() });
    await waitFor(() => expect(el.textContent).toContain("Пицца — 1\u00a0200\u00a0₽ · Суп — 300\u00a0₽"));
  });

  it("мест нет — «Мест ещё нет.»", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([]);
    const el = await mount(PlacesScreen, { onBack: vi.fn(), onAuthRequired: vi.fn() });
    await waitFor(() => expect(el.textContent).toContain("Мест ещё нет."));
  });

  it("«Удалить» спрашивает, называя место; после ОК — в архив и список перечитан", async () => {
    const list = vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValueOnce([DODO]).mockResolvedValueOnce([]);
    const archive = vi.spyOn(apiClient, "archiveFoodPlace").mockResolvedValue();
    const el = await mount(PlacesScreen, { onBack: vi.fn(), onAuthRequired: vi.fn() });
    await waitFor(() => expect(el.textContent).toContain("Додо"));
    await click(button(el, "Удалить"));
    expect(el.textContent).toContain("Удалить «Додо»?");
    await click(button(el.querySelector('[role="group"]')!, "Удалить"));
    await waitFor(() => expect(el.textContent).toContain("Мест ещё нет."));
    expect(archive).toHaveBeenCalledWith(1);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("отказ архивации виден над списком, даже когда места уже нет", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValueOnce([DODO]).mockResolvedValueOnce([]);
    vi.spyOn(apiClient, "archiveFoodPlace").mockRejectedValue(new Error("Места больше нет."));
    const el = await mount(PlacesScreen, { onBack: vi.fn(), onAuthRequired: vi.fn() });
    await waitFor(() => expect(el.textContent).toContain("Додо"));
    await click(button(el, "Удалить"));
    await click(button(el.querySelector('[role="group"]')!, "Удалить"));
    await waitFor(() => expect(el.textContent).toContain("Мест ещё нет."));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("Места больше нет.");
  });

  it("«Изменить» открывает редактор, сохранение возвращает к перечитанному списку", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValueOnce([DODO]).mockResolvedValueOnce([{ ...DODO, name: "Додо пицца" }]);
    const save = vi.spyOn(apiClient, "saveFoodPlace").mockResolvedValue({ ...DODO, name: "Додо пицца" });
    const el = await mount(PlacesScreen, { onBack: vi.fn(), onAuthRequired: vi.fn() });
    await waitFor(() => expect(el.textContent).toContain("Додо"));
    await click(button(el, "Изменить"));
    await type(field(el, "Название места"), "Додо пицца");
    await click(button(el, "Сохранить"));
    await waitFor(() => expect(el.textContent).toContain("🍴 Додо пицца"));
    expect(save).toHaveBeenCalledWith(1, { name: "Додо пицца", menu: [{ id: 11, name: "Пицца", price: 1200 }, { id: 12, name: "Суп", price: 300 }] });
  });
});

describe("консоль: места — редактор", () => {
  it("новое место: строки блюд, цена только цифрами", async () => {
    const save = vi.spyOn(apiClient, "saveFoodPlace").mockResolvedValue({ id: 2, name: "Шаурмечная", menu: [] });
    const p = editorProps();
    const el = await mount(PlaceEditor, p);
    expect(el.querySelector("h2")?.textContent).toBe("Новое место");
    await type(field(el, "Название места"), "Шаурмечная");
    await click(button(el, "+ Блюдо"));
    await type(field(el, "Блюдо 1"), "Шаурма");
    await type(field(el, "Цена блюда 1, ₽"), "1 200 ₽");
    expect(field(el, "Цена блюда 1, ₽").value).toBe("1200");
    // Без `type="text"` поля рисовались голым браузерным видом, а не как в консоли.
    for (const label of ["Название места", "Блюдо 1", "Цена блюда 1, ₽"]) expect(field(el, label).getAttribute("type")).toBe("text");
    await click(button(el, "Сохранить"));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith(null, { name: "Шаурмечная", menu: [{ name: "Шаурма", price: 1200 }] });
  });

  it("блюдо без цены — ошибка с его именем, на сервер ничего не ушло", async () => {
    const save = vi.spyOn(apiClient, "saveFoodPlace");
    const el = await mount(PlaceEditor, editorProps());
    await type(field(el, "Название места"), "Шаурмечная");
    await click(button(el, "+ Блюдо"));
    await type(field(el, "Блюдо 1"), "Шаурма");
    await click(button(el, "Сохранить"));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("У «Шаурма» не указана цена.");
    expect(save).not.toHaveBeenCalled();
  });

  it("стёртое имя существующего блюда — ошибка, а не тихое удаление", async () => {
    const save = vi.spyOn(apiClient, "saveFoodPlace");
    const el = await mount(PlaceEditor, editorProps(DODO));
    await type(field(el, "Блюдо 1"), "");
    await click(button(el, "Сохранить"));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe(EMPTY_DISH_NAME);
    expect(save).not.toHaveBeenCalled();
  });

  it("30 блюд — «+ Блюдо» нет, и сказано почему (Review Focus №3)", async () => {
    const menu = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Блюдо ${i + 1}`, price: 100 }));
    const el = await mount(PlaceEditor, editorProps({ id: 5, name: "Столовая", menu }));
    expect(el.querySelectorAll('[data-testid="dish-row"]')).toHaveLength(30);
    expect(maybeButton(el, "+ Блюдо")).toBeUndefined();
    expect(el.textContent).toContain(FOOD_MENU_FULL_HINT);
  });

  it("отказ сервера — над «Сохранить»", async () => {
    vi.spyOn(apiClient, "saveFoodPlace").mockRejectedValue(new Error("В меню два блюда с одним названием — в чате их кнопки не различить."));
    const el = await mount(PlaceEditor, editorProps(DODO));
    await click(button(el, "Сохранить"));
    await waitFor(() => expect(el.querySelector('[role="alert"]')).not.toBeNull());
    const alert = el.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.textContent).toBe("В меню два блюда с одним названием — в чате их кнопки не различить.");
    expect(alert.nextElementSibling?.contains(button(el, "Сохранить"))).toBe(true);
  });
});
