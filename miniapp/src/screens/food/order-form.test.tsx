// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../../api/client";
import { OrderForm } from "./OrderForm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = null; host = null; vi.restoreAllMocks(); });
async function settle(times = 10) { for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); }
function byText(el: HTMLElement, text: string) {
  return [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
}
function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function mountForm(onDone: (orderId: number) => void, onEditPlaces?: () => void) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(OrderForm, { onDone, onCancel: vi.fn(), onEditPlaces, today: "2026-10-08" }))); });
  await settle();
  return host;
}

describe("OrderForm", () => {
  it("по умолчанию «на смене»; выбранное место и «куда сдавать» уходят в createOrder", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([{ id: 3, name: "Шаурмечная", menu: [{ id: 11, name: "Шаурма", price: 350, unit: "pcs", stepGrams: null }] }]);
    vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue([{ id: 2, displayName: "Игорь", reachable: true, role: "worker", onShift: true }]);
    const create = vi.spyOn(apiClient, "createOrder").mockResolvedValue({ order: { id: 7 } as never, delivered: 2, unreachable: [] });
    const onDone = vi.fn();
    const el = await mountForm(onDone);
    await act(async () => byText(el, "Шаурмечная").click());
    await act(async () => type(el.querySelector<HTMLInputElement>("input[name=pay-hint]")!, "Наличкой мне"));
    await act(async () => byText(el, "Разослать").click());
    await settle();
    expect(create).toHaveBeenCalledWith({ placeId: 3, note: null, payHint: "Наличкой мне", closesAt: null, title: null, allowCustom: true, audience: { kind: "on_shift" } });
    expect(onDone).toHaveBeenCalledWith(7);
  });

  it("«Без меню» отправляет placeId null", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([]);
    vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue([{ id: 2, displayName: "Игорь", reachable: true, role: "worker", onShift: true }]);
    const create = vi.spyOn(apiClient, "createOrder").mockResolvedValue({ order: { id: 8 } as never, delivered: 2, unreachable: [] });
    const el = await mountForm(vi.fn());
    await act(async () => byText(el, "Разослать").click());
    await settle();
    expect(create.mock.calls[0]![0].placeId).toBeNull();
  });

  // Недостижимые есть — как у опроса (Задача 7): onDone откладывается до
  // явного «ОК», чтобы «дошло не всем» не проскочило мимо запускающего.
  it("недостижимые в ответе — отчёт «Отправлено/Не дошло» и onDone только по «ОК»", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([]);
    vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue([{ id: 2, displayName: "Игорь", reachable: true, role: "worker", onShift: true }]);
    vi.spyOn(apiClient, "createOrder").mockResolvedValue({ order: { id: 9 } as never, delivered: 1, unreachable: ["Марк"] });
    const onDone = vi.fn();
    const el = await mountForm(onDone);
    await act(async () => byText(el, "Разослать").click());
    await settle();
    expect(el.textContent).toContain("Отправлено: 1. Не дошло: Марк");
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => byText(el, "ОК").click());
    expect(onDone).toHaveBeenCalledWith(9);
  });

  // Отказ сервера (например, «Время уже прошло…») — текстом под формой, экран
  // не должен виснуть без объяснения; тот же приём, что в PollForm.
  it("ошибка сервера показывается текстом, форма не закрывается", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([]);
    vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue([{ id: 2, displayName: "Игорь", reachable: true, role: "worker", onShift: true }]);
    vi.spyOn(apiClient, "createOrder").mockRejectedValue(new Error("Время уже прошло — поставь позже или оставь пустым."));
    const onDone = vi.fn();
    const el = await mountForm(onDone);
    await act(async () => byText(el, "Разослать").click());
    await settle();
    expect(el.textContent).toContain("Время уже прошло");
    expect(onDone).not.toHaveBeenCalled();
  });

  // Ревью раунд 1, находка №3: контракт `Interfaces` брифа называл только
  // onDone/onCancel, но без ссылки на места человек без единого заведённого
  // места не видит, куда идти. `onEditPlaces` — необязательный проп, шаг
  // FoodScreen передаёт его сам.
  it("«🍴 Места и меню» вызывает onEditPlaces; без мест — подсказка", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([]);
    vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue([{ id: 2, displayName: "Игорь", reachable: true, role: "worker", onShift: true }]);
    const onEditPlaces = vi.fn();
    const el = await mountForm(vi.fn(), onEditPlaces);
    expect(el.textContent).toContain("Мест пока нет — добавь через «🍴 Места и меню» или заказывай без меню.");
    await act(async () => byText(el, "🍴 Места и меню").click());
    expect(onEditPlaces).toHaveBeenCalled();
  });

  it("с уже заведёнными местами подсказка «Мест пока нет» не показывается", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([{ id: 3, name: "Шаурмечная", menu: [] }]);
    vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue([{ id: 2, displayName: "Игорь", reachable: true, role: "worker", onShift: true }]);
    const el = await mountForm(vi.fn());
    expect(el.textContent).not.toContain("Мест пока нет");
  });

  const ONE = [{ id: 2, displayName: "Игорь", reachable: true, role: "worker" as const, onShift: true }];
  const field = (el: HTMLElement, name: string) => el.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
  async function mountWithPlace() {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([{ id: 3, name: "Додо", menu: [{ id: 11, name: "Пицца", price: 500, unit: "pcs", stepGrams: null }] }]);
    vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue(ONE);
    const create = vi.spyOn(apiClient, "createOrder").mockResolvedValue({ order: { id: 7 } as never, delivered: 1, unreachable: [] });
    const el = await mountForm(vi.fn());
    return { el, create };
  }

  it("название, дата, время и запрет своих позиций уходят одним closesAt", async () => {
    const { el, create } = await mountWithPlace();
    await act(async () => byText(el, "Додо").click());
    await act(async () => type(field(el, "order-title"), "  Икра, доставка 09.10 "));
    await act(async () => type(field(el, "closes-date"), "2026-10-09"));
    await act(async () => type(field(el, "closes-time"), "16:00"));
    await act(async () => field(el, "allow-custom").click());
    await act(async () => byText(el, "Разослать").click());
    await settle();
    expect(create).toHaveBeenCalledWith({
      placeId: 3, title: "Икра, доставка 09.10", allowCustom: false, note: null, payHint: null, closesAt: "2026-10-09T16:00", audience: { kind: "on_shift" },
    });
  });

  it("дата без времени гасит «Разослать» с подсказкой; только время — сегодня командное", async () => {
    const { el, create } = await mountWithPlace();
    await act(async () => type(field(el, "closes-date"), "2026-10-09"));
    expect(byText(el, "Разослать").disabled).toBe(true);
    expect(el.textContent).toContain("Укажи и время");
    await act(async () => type(field(el, "closes-date"), ""));
    await act(async () => type(field(el, "closes-time"), "23:30"));
    expect(byText(el, "Разослать").disabled).toBe(false);
    await act(async () => byText(el, "Разослать").click());
    await settle();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ closesAt: "2026-10-08T23:30" }));
  });

  it("дата ограничена сегодня..+14 дней", async () => {
    const { el } = await mountWithPlace();
    expect(field(el, "closes-date").min).toBe("2026-10-08");
    expect(field(el, "closes-date").max).toBe("2026-10-22");
  });

  it("«Без меню» принудительно включает и гасит «свои позиции»", async () => {
    const { el, create } = await mountWithPlace();
    await act(async () => byText(el, "Додо").click());
    await act(async () => field(el, "allow-custom").click());
    expect(field(el, "allow-custom").checked).toBe(false);
    await act(async () => byText(el, "Без меню").click());
    expect(field(el, "allow-custom").checked).toBe(true);
    expect(field(el, "allow-custom").disabled).toBe(true);
    await act(async () => byText(el, "Разослать").click());
    await settle();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ placeId: null, allowCustom: true }));
  });
});
