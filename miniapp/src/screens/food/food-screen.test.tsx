// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type OrderView, type PlaceView } from "../../api/client";
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
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(FoodScreen, { initial, onClose: vi.fn(), today: "2026-10-08" }))); });
  await settle();
  return host;
}

const DODO: PlaceView = { id: 1, name: "Додо", menu: [{ id: 11, name: "Пицца", price: 500, unit: "pcs", stepGrams: null }] };

const ORDER: OrderView = {
  id: 7, creatorId: 1, creatorName: "Аня", placeId: 3, title: null, placeName: "Шаурмечная", allowCustom: true,
  menu: [{ id: 11, name: "Шаурма", price: 350, unit: "pcs", stepGrams: null }], note: null, payHint: null,
  closesAt: "2026-09-29T12:30", closes: "до 12:30", open: true, closed: false, cancelled: false,
  isCreator: false, canManage: false, myItems: [], myTotal: 0, declined: false,
  recipientCount: 3, respondedCount: 1, dishes: [], total: 0, people: null,
  payment: { myPaid: false, paidCount: 0, total: 0, rows: null },
};

describe("FoodScreen", () => {
  it("список опросов и заказов грузится без подсказки про недоделанное", async () => {
    vi.spyOn(apiClient, "getPolls").mockResolvedValue([]);
    vi.spyOn(apiClient, "getOrders").mockResolvedValue([]);
    const el = await mount({ view: "list" });
    expect(el.textContent).not.toContain("Заказы еды появятся в следующем обновлении.");
    expect(el.textContent).toContain("Пока ничего не запускали.");
  });

  // Задача 14: ссылка бота на заказ (`?screen=orders&order=7`, см.
  // `food-route.ts`) должна открывать сам заказ, а не откатываться на список.
  it("маршрут «order» открывает OrderScreen с этим заказом", async () => {
    const getOrder = vi.spyOn(apiClient, "getOrder").mockResolvedValue(ORDER);
    const el = await mount({ view: "order", orderId: 7 });
    expect(getOrder).toHaveBeenCalledWith(7);
    expect(el.textContent).toContain("Шаурмечная");
  });

  // Ревью раунд 1, находка №1: `o.closes` — просто форматированный срок, он
  // не гаснет сам, когда заказ закрыт/отменён — карточка молча показывала бы
  // «до 12:30» и закрытому, и отменённому заказу, будто приём ещё идёт.
  it("карточки списка показывают статус закрытого и отменённого заказа", async () => {
    vi.spyOn(apiClient, "getPolls").mockResolvedValue([]);
    vi.spyOn(apiClient, "getOrders").mockResolvedValue([
      { ...ORDER, id: 8, placeName: "Закрытый", open: false, closed: true, cancelled: false },
      { ...ORDER, id: 9, placeName: "Отменённый", open: false, closed: false, cancelled: true },
    ]);
    const el = await mount({ view: "list" });
    expect(el.textContent).toContain("Закрытый");
    expect(el.textContent).toContain("Собирает Аня · приём закрыт");
    expect(el.textContent).toContain("Отменённый");
    expect(el.textContent).toContain("Собирает Аня · отменён");
    // Срок «до 12:30» из фикстуры не должен всплывать — заказ уже не открыт.
    expect(el.textContent).not.toContain("до 12:30");
  });

  it("закрытый заказ с несданными деньгами — «сдали 1 из 3», у идущего и отменённого строки нет", async () => {
    vi.spyOn(apiClient, "getPolls").mockResolvedValue([]);
    vi.spyOn(apiClient, "getOrders").mockResolvedValue([
      { ...ORDER, id: 8, placeName: "Закрытый", open: false, closed: true, payment: { myPaid: false, paidCount: 1, total: 3, rows: null } },
      { ...ORDER, id: 9, placeName: "Идущий", payment: { myPaid: false, paidCount: 0, total: 3, rows: null } },
      { ...ORDER, id: 10, placeName: "Отменённый", open: false, closed: true, cancelled: true, payment: { myPaid: false, paidCount: 0, total: 3, rows: null } },
    ]);
    const el = await mount({ view: "list" });
    expect(el.textContent).toContain("Собирает Аня · приём закрыт · сдали 1 из 3");
    expect(el.textContent?.match(/сдали/g)).toHaveLength(1);
  });

  // Кнопка «🍱 Новый заказ» в боте и в шапке списка ведёт сюда — форма
  // заказа, а не заглушка «в следующем обновлении». `toContain("Новый заказ")`
  // сам по себе не различает форму от списка — на списке есть кнопка «🍱 Новый
  // заказ», та же подстрока (находка ревью раунда 1 №2: тест не мог упасть).
  // Проверяем то, чего на списке нет вовсе: `getFoodPlaces`, которую список
  // не дёргает, и «Разослать» — кнопку, которая есть только у формы.
  it("маршрут «new-order» открывает OrderForm, а не список", async () => {
    const getFoodPlaces = vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([]);
    vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue([]);
    const el = await mount({ view: "new-order" });
    expect(getFoodPlaces).toHaveBeenCalled();
    expect(byText(el, "Разослать")).toBeTruthy();
    expect(el.querySelector("input[name=pay-hint]")).toBeTruthy();
  });

  // Задача 8: места готовы, и маршрут «Места» больше не откатывается на
  // список опросов — он показывает сам список мест с меню.
  it("маршрут «Места» загружает список мест, а не откатывается на опросы", async () => {
    const getFoodPlaces = vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([DODO]);
    const el = await mount({ view: "places" });
    expect(getFoodPlaces).toHaveBeenCalled();
    expect(el.textContent).toContain("Додо");
    expect(el.textContent).toContain("Пицца — 500\u00a0₽");
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

  // Отказ архивации (например, место уже удалено кем-то другим — 404 «Места
  // больше нет.») раньше терялся молча: `try/finally` без `catch` — отказ
  // становился необработанным rejection'ом, а карточка ничего не говорила.
  it("отказ архивации показывает текст ошибки, а не тонет молча", async () => {
    const getFoodPlaces = vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([DODO]);
    vi.spyOn(apiClient, "archiveFoodPlace").mockRejectedValue(new Error("Места больше нет."));
    const el = await mount({ view: "places" });
    await act(async () => byText(el, "Удалить").click());
    getFoodPlaces.mockResolvedValue([]);
    await act(async () => byText(el, "Удалить").click());
    await settle();
    expect(el.textContent).toContain("Места больше нет.");
  });
});

describe("FoodScreen — деньги меню", () => {
  // Список мест писал «1200 ₽» без разбивки разрядов, а форма
  // заказа — «1 200 ₽». Одна строка денег на обе морды — `menuPreview`.
  it("меню места — те же деньги, что везде: «1 200 ₽»", async () => {
    vi.spyOn(apiClient, "getFoodPlaces").mockResolvedValue([{ id: 1, name: "Додо", menu: [{ id: 11, name: "Пицца", price: 1200, unit: "pcs", stepGrams: null }] }]);
    const el = await mount({ view: "places" });
    // formatMoney склеивает разряды и «₽» неразрывным пробелом — литерал с обычным пробелом не совпал бы.
    expect(el.textContent).toContain("Пицца — 1\u00a0200\u00a0₽");
  });
});

describe("FoodScreen — заголовок заказа в списке", () => {
  it("карточка называется по названию сбора, иначе по месту", async () => {
    vi.spyOn(apiClient, "getPolls").mockResolvedValue([]);
    vi.spyOn(apiClient, "getOrders").mockResolvedValue([{ ...ORDER, id: 8, title: "Икра, доставка 09.10" }, ORDER]);
    const el = await mount({ view: "list" });
    expect(el.textContent).toContain("🍱 Икра, доставка 09.10");
    expect(el.textContent).toContain("🍱 Шаурмечная");
  });
});

