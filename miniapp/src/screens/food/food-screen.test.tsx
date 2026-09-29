// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../../api/client";
import { FoodScreen } from "./FoodScreen";
import type { FoodRoute } from "./food-route";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = null; host = null; vi.restoreAllMocks(); });
async function settle(times = 10) { for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); }

async function mount(initial: FoodRoute) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(FoodScreen, { initial, onClose: vi.fn() }))); });
  await settle();
  return host;
}

describe("FoodScreen", () => {
  // Кнопка «🍱 Новый заказ» в боте (Задачи 8 и 14 их ещё не реализовали) вела
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

  it("маршрут «Места» — тот же откат и та же подсказка", async () => {
    const getPolls = vi.spyOn(apiClient, "getPolls").mockResolvedValue([]);
    const el = await mount({ view: "places" });
    expect(getPolls).toHaveBeenCalled();
    expect(el.textContent).toContain("Заказы еды появятся в следующем обновлении.");
  });

  it("обычный список опросов подсказку не показывает", async () => {
    vi.spyOn(apiClient, "getPolls").mockResolvedValue([]);
    const el = await mount({ view: "list" });
    expect(el.textContent).not.toContain("Заказы еды появятся в следующем обновлении.");
  });
});
