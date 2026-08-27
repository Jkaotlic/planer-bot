// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type WorkerCollection } from "../../api/client";
import { TeamCollections } from "./TeamCollections";

/**
 * Ловушка необработанных отказов — это Node API, а мини-апп живёт в браузере,
 * поэтому типы Node сюда намеренно не подключены: иначе и прод-код смог бы
 * звать `process`, не получив ни слова от компилятора. (До vitest 4 так и было —
 * он подтягивал их глобально, и граница держалась случайно.) Объявляем ровно то,
 * чем пользуемся, и ровно в том файле, где это нужно.
 */
declare const process: {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  off(event: "unhandledRejection", listener: (reason: unknown) => void): void;
};
const nodeProcess = process;

/**
 * Секция «Идёт сбор» во вкладке «Команда».
 *
 * Главное, что здесь проверяется, — секция умеет НЕ рисоваться. Пустой
 * заголовок над надписью «сборов нет» занимал бы место каждый день ради
 * события раз в месяц, а отказ сервера не должен уносить с экрана график
 * команды, к которому сбор не имеет никакого отношения.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COFFEE: WorkerCollection = {
  id: 1, title: "Кофемашина", personName: null,
  collectUrl: "https://example.test/c/1",
  amountPerPerson: 1000, totalGoal: 25000,
  deadline: "2026-08-15", eventDate: null,
  paid: false, paidCount: 2, recipientCount: 5,
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(TeamCollections)));
  });
  await settle();
  return host;
}

describe("TeamCollections", () => {
  it("без активных сборов не рисует ничего — ни заголовка, ни пустого состояния", async () => {
    const load = vi.spyOn(apiClient, "getMyCollections").mockResolvedValue([]);

    const el = await mount();
    expect(load).toHaveBeenCalled();
    expect(el.textContent).toBe("");
  });

  it("показывает повод, сумму, срок и ссылку", async () => {
    vi.spyOn(apiClient, "getMyCollections").mockResolvedValue([COFFEE]);

    const el = await mount();
    const text = el.textContent ?? "";
    expect(text).toContain("Идёт сбор");
    expect(text).toContain("Кофемашина");
    expect(text).toContain("по 1\u00A0000\u00A0₽");
    expect(text).toContain("нужно 25\u00A0000\u00A0₽");
    expect(text).toContain("до 15 августа");

    const link = [...el.querySelectorAll("a")].find((a) => (a.textContent ?? "").includes("Открыть сбор"));
    expect(link?.getAttribute("href")).toBe("https://example.test/c/1");
    // Уходит из мини-аппа наружу, в браузер или в приложение банка.
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("заголовок во множественном, когда сборов несколько", async () => {
    vi.spyOn(apiClient, "getMyCollections").mockResolvedValue([
      COFFEE,
      { ...COFFEE, id: 2, title: "Свадьба", personName: "Пётр Иванов" },
    ]);

    const el = await mount();
    expect(el.textContent ?? "").toContain("Идут сборы");
    expect(el.textContent ?? "").not.toContain("Идёт сбор");
  });

  it("сбор без единой суммы и без срока не рисует пустую вторую строку", async () => {
    vi.spyOn(apiClient, "getMyCollections").mockResolvedValue([
      { ...COFFEE, amountPerPerson: null, totalGoal: null, deadline: null },
    ]);

    const el = await mount();
    // Пустая строка под поводом даёт зазор, который читается как «тут что-то
    // не загрузилось». У заполненного сбора она есть — проверено выше.
    expect(el.querySelector('[data-testid="collection-meta"]')).toBeNull();
  });

  it("сбор на человека называет, на кого — как это же написано в письме команде", async () => {
    vi.spyOn(apiClient, "getMyCollections").mockResolvedValue([
      { ...COFFEE, title: "Свадьба", personName: "Пётр Иванов" },
    ]);

    const el = await mount();
    // «Свадьба» без имени в списке из трёх сборов не говорит ничего: имя в
    // именительном через тире — та же форма, что в тексте бота.
    expect(el.textContent ?? "").toContain("Свадьба — Пётр Иванов");
  });

  it("отказ сервера не роняет вкладку «Команда»", async () => {
    const load = vi.spyOn(apiClient, "getMyCollections").mockRejectedValue(new Error("сеть"));

    // Пустой экран сам по себе ничего не доказывает: начальное состояние тоже
    // пустое, и тест был бы зелёным даже без единого `catch`. Доказывает
    // именно отсутствие необработанного отказа — он всплывает наружу, за
    // пределы секции, и это и есть «уронить вкладку».
    const escaped: unknown[] = [];
    const onUnhandled = (reason: unknown) => escaped.push(reason);
    nodeProcess.on("unhandledRejection", onUnhandled);
    try {
      const el = await mount();
      expect(load).toHaveBeenCalled();
      // Сбор — не главное на этом экране: график должен остаться на месте.
      expect(el.textContent).toBe("");
    } finally {
      nodeProcess.off("unhandledRejection", onUnhandled);
    }
    expect(escaped).toEqual([]);
  });

  it("тап по «Я перевёл» отмечает и меняет счёт", async () => {
    vi.spyOn(apiClient, "getMyCollections").mockResolvedValue([COFFEE]);
    const mark = vi.spyOn(apiClient, "setCollectionPaid")
      .mockResolvedValue({ paid: true, paidCount: 3, recipientCount: 5 });

    const el = await mount();
    expect(el.textContent ?? "").toContain("отметились 2 из 5");

    const button = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Я перевёл"));
    await act(async () => { button!.click(); });
    await settle();

    expect(mark).toHaveBeenCalledWith(1, true);
    expect(el.textContent ?? "").toContain("Вы отметились");
    expect(el.textContent ?? "").toContain("отметились 3 из 5");
  });

  it("снятая галочка возвращает кнопку «Я перевёл»", async () => {
    vi.spyOn(apiClient, "getMyCollections").mockResolvedValue([{ ...COFFEE, paid: true, paidCount: 3 }]);
    vi.spyOn(apiClient, "setCollectionPaid").mockResolvedValue({ paid: false, paidCount: 2, recipientCount: 5 });

    const el = await mount();
    const button = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Вы отметились"));
    await act(async () => { button!.click(); });
    await settle();

    expect(el.textContent ?? "").toContain("Я перевёл");
    expect(el.textContent ?? "").toContain("отметились 2 из 5");
  });

  // Галочка — утверждение человека о деньгах. Показать её, не записав, значит
  // показать неправду: он уйдёт с экрана уверенным, что отметился.
  it("отказ сервера не оставляет галочку на экране", async () => {
    vi.spyOn(apiClient, "getMyCollections").mockResolvedValue([COFFEE]);
    vi.spyOn(apiClient, "setCollectionPaid").mockRejectedValue(new Error("Сбор закрыт"));

    const el = await mount();
    const button = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Я перевёл"));
    await act(async () => { button!.click(); });
    await settle();

    expect(el.textContent ?? "").toContain("Я перевёл");
    expect(el.textContent ?? "").not.toContain("Вы отметились");
    expect(el.textContent ?? "").toContain("отметились 2 из 5");
  });
});
