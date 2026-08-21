// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Collection, type CollectionPreview, type CollectionRow, type Employee } from "./api/client";
import { CollectionsScreen } from "./screens/CollectionsScreen";

/**
 * Экран «Сборы» в консоли: список, порядок и форма нового сбора.
 *
 * Списка сборов в консоли до этой работы не было вообще — здесь он строится
 * с нуля, и проверяется именно то, что легко сделать неправильно: порядок
 * приходит с сервера и не пересортировывается на экране, закрытый читается
 * закрытым, а строка открывает СВОЙ редактор, а не чужой.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function collection(patch: Partial<Collection> = {}): Collection {
  return {
    id: 1, kind: "custom", employeeId: null, year: null, celebratedOn: null,
    title: "Кофемашина", eventDate: null, deadline: null,
    amountPerPerson: null, totalGoal: null, collectUrl: null, messageText: null,
    closedAt: null, scheduledSendOn: null, scheduleNotifiedAt: null,
    sentAt: null, sentCount: 0, sendCount: 0, createdAt: "2026-08-01T10:00:00Z",
    ...patch,
  };
}

function row(patch: Partial<CollectionRow> & { collection: Collection }): CollectionRow {
  return {
    personName: null,
    title: patch.collection.title ?? "Сбор",
    status: "pending",
    active: true,
    ...patch,
  };
}

function employee(patch: Partial<Employee> = {}): Employee {
  return {
    id: 5, displayName: "Иванова Анна", isAdmin: false, isActive: true, telegramUserId: null,
    birthDate: null, preferredName: null, address: "Иванова",
    excludedFromAssignment: false, excludedFromSwaps: false,
    isObserver: false, selfScheduleEnabled: false,
    ...patch,
  };
}

function preview(patch: Partial<CollectionPreview> = {}): CollectionPreview {
  return {
    id: 1, kind: "custom", title: "Кофемашина", personName: null, employeeId: null,
    collectUrl: "https://sber.ru/x", message: "текст сбора",
    recipients: [{ employeeId: 2, displayName: "Кто-то" }],
    blocker: null, sendCount: 0, lastSentAt: null,
    ...patch,
  };
}

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
    root!.render(createElement(CollectionsScreen));
  });
  await settle();
  return host;
}

function inputByLabel(el: HTMLElement, label: string): HTMLInputElement {
  const found = el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!found) throw new Error(`не нашёл поле «${label}»`);
  return found;
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);
  if (!found) throw new Error(`не нашёл кнопку с подписью «${text}»`);
  return found;
}

function personRow(el: HTMLElement, name: string): HTMLButtonElement {
  const found = [...el.querySelectorAll<HTMLButtonElement>(".person-picker-row")].find((r) =>
    (r.textContent ?? "").includes(name),
  );
  if (!found) throw new Error(`не нашёл строку пикера «${name}»`);
  return found;
}

async function type(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("CollectionsScreen", () => {
  // Его правка от 2026-08-21: живые сборы лежали под всем календарём дней
  // рождения, и до того, ради чего экран открывают чаще всего, приходилось
  // прокручивать год чужих праздников.
  it("ставит идущие сборы выше календаря дней рождения", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([
      { employeeId: 7, displayName: "Марк Волков", birthDateLabel: "25 августа", daysUntil: 4,
        celebratedOn: "2026-08-25", campaign: null } as never,
    ]);
    vi.spyOn(apiClient, "getEmployees").mockResolvedValue([]);
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([
      row({ collection: collection({ id: 1, title: "Кофемашина" }), title: "Кофемашина" }),
    ]);

    const el = await mount();
    const headings = [...el.querySelectorAll("h3")].map((h) => (h.textContent ?? "").trim());
    expect(headings).toContain("Идут сборы");
    expect(headings.indexOf("Идут сборы")).toBeLessThan(headings.indexOf("Ближайшие дни рождения"));
    expect(headings.indexOf("Идут сборы")).toBeLessThan(headings.indexOf("Новый сбор"));
  });

  it("рисует активные выше закрытых и называет закрытый закрытым", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
    vi.spyOn(apiClient, "getEmployees").mockResolvedValue([]);
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([
      row({ collection: collection({ id: 1, title: "Идёт" }), title: "Идёт" }),
      row({
        collection: collection({ id: 2, title: "Закрытый", collectUrl: "https://x", sentCount: 3, sendCount: 1, closedAt: "2026-08-05T10:00:00Z" }),
        title: "Закрытый", status: "sent", active: false,
      }),
    ]);

    const el = await mount();
    // Закрытый убран под свёрнутую секцию: на экране сначала только живой.
    const visible = [...el.querySelectorAll<HTMLElement>('[data-testid="collection-card"]')];
    expect(visible.map((card) => card.textContent)).toEqual([expect.stringContaining("Идёт")]);
    expect(el.textContent).toContain("Закрытые · 1");

    act(() => el.querySelector<HTMLButtonElement>(".archive-toggle")!.click());

    const cards = [...el.querySelectorAll<HTMLElement>('[data-testid="collection-card"]')];
    expect(cards).toHaveLength(2);
    // Порядок задан сервером — экран его не пересортировывает, и разбивка на
    // две секции этого не меняет: живой выше закрытого, как и пришло.
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("Идёт"),
      expect.stringContaining("Закрытый"),
    ]);
    expect(cards[1]!.textContent).toContain("Закрыт");
    // Закрытый — это не «Разослано»: иначе чип звал бы дожимать то, что уже
    // собрали. Проверяется отдельно, потому что строка и правда разослана.
    expect(cards[1]!.textContent).not.toContain("Разослано");
  });

  it("«Создать» погашена, пока не введён повод", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
    vi.spyOn(apiClient, "getEmployees").mockResolvedValue([]);
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([]);

    const el = await mount();
    const create = buttonByText(el, "Создать");
    expect(create.disabled).toBe(true);

    // Повод из одних пробелов поводом не считается — иначе сбор без названия
    // ушёл бы команде безымянным.
    await type(inputByLabel(el, "Повод"), "   ");
    expect(create.disabled).toBe(true);

    await type(inputByLabel(el, "Повод"), "Кофемашина");
    expect(create.disabled).toBe(false);
  });

  it("строка разворачивает СВОЙ редактор — предпросмотр запрашивается по её id", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
    vi.spyOn(apiClient, "getEmployees").mockResolvedValue([]);
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([
      row({ collection: collection({ id: 11, title: "Первый" }), title: "Первый" }),
      row({ collection: collection({ id: 22, title: "Второй" }), title: "Второй" }),
    ]);
    const load = vi.spyOn(apiClient, "getCollectionPreview").mockResolvedValue(preview({ id: 22, title: "Второй" }));

    const el = await mount();
    const cards = [...el.querySelectorAll<HTMLElement>('[data-testid="collection-card"]')];
    await act(async () => buttonByText(cards[1]!, "Открыть").click());
    await settle();

    expect(load).toHaveBeenCalledWith(22);
    expect(load).not.toHaveBeenCalledWith(11);
  });
});

/**
 * `PersonPicker` сам по себе проверен изолированно (`person-picker.test.tsx`),
 * но это не проверяет, что «Сборы» подключили его правильно: что клик по
 * строке кладёт id туда же, куда клал `<select>`, и что `disabled` приходит
 * от того же условия, что и раньше. Второе особенно дорого молчаливой
 * поломкой: `subjectFrozen` — это «команда уже прочитала, на что скидывается,
 * менять виновника нельзя», и если блокировка потеряется при переносе на
 * `PersonPicker`, ничего не откажет громко — админ просто сможет тихо
 * переставить виновника сбора, который люди уже видели.
 */
describe("PersonPicker подключён к экрану «Сборы»", () => {
  it("клик по строке пикера уходит в create тем же employeeId, что клал <select>", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
    vi.spyOn(apiClient, "getEmployees").mockResolvedValue([employee({ id: 5, displayName: "Иванова Анна" })]);
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([]);
    const create = vi
      .spyOn(apiClient, "createCollection")
      .mockResolvedValue(collection({ id: 99, title: "Кофемашина" }));

    const el = await mount();
    await type(inputByLabel(el, "Повод"), "Кофемашина");
    // Выбор ДОЛЖЕН пережить клик — иначе следующая проверка ловит только то,
    // что кнопка «Создать» вообще нажимается, а не то, что id дошёл до запроса.
    await act(async () => { personRow(el, "Иванова Анна").click(); });
    await act(async () => { buttonByText(el, "Создать").click(); });
    await settle();

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ employeeId: 5 }));
  });

  it("замороженный повод (команда уже прочитала, на что скидывается) блокирует и выбор человека", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([]);
    vi.spyOn(apiClient, "getEmployees").mockResolvedValue([employee({ id: 5, displayName: "Иванова Анна" })]);
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([
      row({
        collection: collection({ id: 1, title: "Кофемашина", employeeId: 5, sendCount: 1 }),
        personName: "Иванова Анна",
      }),
    ]);
    vi.spyOn(apiClient, "getCollectionPreview").mockResolvedValue(preview({ sendCount: 1 }));

    const el = await mount();
    await act(async () => { buttonByText(el, "Открыть").click(); });
    await settle();

    // Строго внутри открытой карточки — у формы «Новый сбор» выше на экране
    // свой PersonPicker, и он ничем не заморожен.
    const card = el.querySelector<HTMLElement>('[data-testid="collection-card"]')!;
    const rows = [...card.querySelectorAll<HTMLButtonElement>(".person-picker-row")];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.disabled).toBe(true);
  });
});
