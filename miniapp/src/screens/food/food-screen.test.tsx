// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type PlaceView } from "../../api/client";
import { FoodScreen } from "./FoodScreen";
import type { FoodRoute } from "./food-route";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = null; host = null; vi.restoreAllMocks(); });
async function settle(times = 10) { for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); }
function byText(el: HTMLElement, text: string) {
  return [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
}

async function mount(initial: FoodRoute) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(FoodScreen, { initial, onClose: vi.fn() }))); });
  await settle();
  return host;
}

const DODO: PlaceView = { id: 1, name: "Додо", menu: [{ id: 11, name: "Пицца", price: 500 }] };

describe("FoodScreen", () => {
  // Кнопка «🍱 Новый заказ» в боте (Задача 14 её ещё не реализовала) вела
  // на оверлей, вечно висящий на «Загружаю…»: `useEffect` списка выходил рано
  // для любого маршрута, кроме «list». Экран должен откатываться на список и
  // объяснять, почему нужного раздела нет, а не молчать пустым спиннером.
  it("«Новый заказ» по ссылке бота откатывается на список опросов и показывает подсказку", async () => {
    const getPolls = vi.spyOn(apiClient, "getPolls").mockResolvedValue([]);
    const el = await mount({ view: "new-order" });
    expect(getPolls).toHaveBeenCalled();
    expect(el.textContent).toContain("Пока ничего не запускали.");
    expect(el.textContent).toContain("Заказы еды появятся в следующем обновлении.");
  });

  it("обычный список опросов подсказку не показывает", async () => {
    vi.spyOn(apiClient, "getPolls").mockResolvedValue([]);
    const el = await mount({ view: "list" });
    expect(el.textContent).not.toContain("Заказы еды появятся в следующем обновлении.");
  });

  // Задача 8: места готовы, и маршрут «Места» больше не откатывается на
  // список опросов — он показывает сам список мест с меню.
  it("маршрут «Места» загружает список мест, а не откатывается на опросы", async () => {
    const getFoodPlaces = vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([DODO]);
    const el = await mount({ view: "places" });
    expect(getFoodPlaces).toHaveBeenCalled();
    expect(el.textContent).toContain("Додо");
    expect(el.textContent).toContain("Пицца — 500 ₽");
    expect(el.textContent).not.toContain("Заказы еды появятся в следующем обновлении.");
  });

  it("«Изменить» открывает редактор с уже заполненным местом", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([DODO]);
    const el = await mount({ view: "places" });
    await act(async () => byText(el, "Изменить").click());
    expect(el.querySelector<HTMLInputElement>("input[name=place-name]")?.value).toBe("Додо");
  });

  it("«Удалить» архивирует место после подтверждения и список обновляется", async () => {
    const getFoodPlaces = vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([DODO]);
    const archive = vi.spyOn(apiClient, "archiveFoodPlace").mockResolvedValue(undefined);
    const el = await mount({ view: "places" });
    // Первый тап вооружает кнопку (ConfirmButton), второй подтверждает.
    await act(async () => byText(el, "Удалить").click());
    getFoodPlaces.mockResolvedValue([]);
    await act(async () => byText(el, "Удалить").click());
    await settle();
    expect(archive).toHaveBeenCalledWith(1);
    expect(el.textContent).toContain("Мест ещё нет.");
  });
});
