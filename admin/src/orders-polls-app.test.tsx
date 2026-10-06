// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthRequiredError, apiClient } from "./api/client";
import { App } from "./App";
import { NAV_ITEMS, navLabel } from "./components/Sidebar";
import { waitFor } from "./test-wait";

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

async function mountApp() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(App)));
  // Загрузка консоли идёт на DEV-моке с задержками — ждём сайдбар, а не тики.
  await waitFor(() => expect(host!.querySelector(".sidebar-nav-item")).not.toBeNull());
  return host;
}

const navItem = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLButtonElement>(".sidebar-nav-item")].find((b) => b.textContent?.includes(label))!;

describe("консоль: пункт «Заказы и опросы»", () => {
  it("стоит сразу после «Анонсов», шапка узкого режима называет его так же", () => {
    const labels = NAV_ITEMS.map((i) => i.label);
    expect(labels.indexOf("Заказы и опросы")).toBe(labels.indexOf("Анонсы") + 1);
    expect(navLabel("orders")).toBe("Заказы и опросы");
  });

  it("открывает экран и грузит заказы и опросы", async () => {
    const getOrders = vi.spyOn(apiClient, "getOrders").mockResolvedValue([]);
    vi.spyOn(apiClient, "getPolls").mockResolvedValue([]);
    const el = await mountApp();
    await act(async () => navItem(el, "Заказы и опросы").click());
    await waitFor(() => expect(el.querySelector("h2.employees-title")?.textContent).toBe("Заказы и опросы"));
    expect(getOrders).toHaveBeenCalled();
  });

  it("истёкшая сессия на экране — экран входа", async () => {
    vi.spyOn(apiClient, "getOrders").mockRejectedValue(new AuthRequiredError("Сессия истекла — войди заново"));
    vi.spyOn(apiClient, "getPolls").mockResolvedValue([]);
    const el = await mountApp();
    await act(async () => navItem(el, "Заказы и опросы").click());
    await waitFor(() => expect(el.textContent).toContain("Панель администратора"));
  });
});
