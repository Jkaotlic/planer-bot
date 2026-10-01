// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Collection, type CollectionPreview, type CollectionRow, type Me, type UpcomingBirthday } from "../../api/client";
import { AdminCollections } from "./AdminCollections";

/**
 * Раскрытый сбор — несколько соседних карточек, и «Да, разослать»,
 * «Собрали, закрыть», «Удалить сбор» стоят в них на том же расстоянии, что и
 * карточка следующего сбора. Без названия сверху непонятно, к какому сбору
 * относится кнопка, которая пишет всей команде или удаляет.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME: Me = {
  id: 9, displayName: "Аня Смирнова", address: "Аня", preferredName: null,
  isAdmin: true, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, startTab: null, canAnnounce: true,
};

function row(
  id: number,
  title: string,
  extra: { personName?: string; kind?: Collection["kind"]; employeeId?: number } = {},
): CollectionRow {
  const collection: Collection = {
    id, kind: extra.kind ?? "custom", employeeId: extra.employeeId ?? null, year: null, celebratedOn: null,
    title, eventDate: null, deadline: null, amountPerPerson: null, totalGoal: null,
    collectUrl: "https://example.com/pay", messageText: null, closedAt: null,
    scheduledSendOn: null, scheduleNotifiedAt: null, autoSendOn: null, autoSentAt: null,
    sentAt: null, sentCount: 0, sendCount: 0, recipientGroupId: null, createdAt: "2026-08-01T10:00:00Z",
  };
  return { collection, personName: extra.personName ?? null, title, status: "ready", active: true };
}

function preview(id: number, title: string, personName: string | null = null): CollectionPreview {
  return {
    id, kind: "custom", title, personName, employeeId: null,
    collectUrl: "https://example.com/pay", message: "текст сбора",
    recipients: [{ employeeId: 2, displayName: "Игорь" }],
    recipientGroupName: null, blocker: null, sendCount: 0, lastSentAt: null,
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

async function settle(times = 12) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 12));
    });
  }
}

async function mount(
  rows: CollectionRow[] = [row(1, "Кофемашина"), row(2, "Принтер")],
  birthdays: UpcomingBirthday[] = [],
) {
  vi.spyOn(apiClient, "getBirthdays").mockResolvedValue(birthdays);
  vi.spyOn(apiClient, "getCollections").mockResolvedValue(rows);
  vi.spyOn(apiClient, "getMe").mockResolvedValue(ME);
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([]);
  vi.spyOn(apiClient, "getCollectionPreview").mockImplementation(async (id) => {
    const found = rows.find((r) => r.collection.id === id);
    return preview(id, found?.title ?? "", found?.personName ?? null);
  });
  vi.spyOn(apiClient, "getBirthdayPreview").mockImplementation(async (employeeId) =>
    ({ ...preview(77, "День рождения", birthdays.find((b) => b.employeeId === employeeId)?.displayName ?? null), kind: "birthday" }));
  vi.spyOn(apiClient, "getCollectionPayments").mockResolvedValue({ rows: [], paidCount: 0, total: 0 });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminCollections, { today: "2026-01-01" })));
  });
  await settle();
  return host;
}

/** Карточка, в которой лежит кнопка с таким текстом. */
function cardOf(el: HTMLElement, label: string): HTMLElement {
  const btn = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label));
  if (!btn) throw new Error(`нет кнопки «${label}»`);
  return btn.closest(".ui-card") as HTMLElement;
}

/** Подпись-владелец карточки — именно её элемент, а не весь текст: имя
 *  человека и так лежит в тексте рассылки («все, кроме Ани»), и проверка по
 *  всему тексту прошла бы и без подписи. */
function ownerOf(card: HTMLElement): string | undefined {
  return card.querySelector(".ui-item__owner")?.textContent ?? undefined;
}

async function openNth(el: HTMLElement, n: number) {
  const open = [...el.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === "Открыть")[n]!;
  await act(async () => open.click());
  await settle();
}

describe("карточки раскрытого сбора называют свой сбор", () => {
  it("рассылка и закрытие/удаление несут название своего сбора и чужого не несут", async () => {
    const el = await mount();

    await openNth(el, 0);
    expect(cardOf(el, "Разослать").textContent).toContain("Кофемашина");
    expect(cardOf(el, "Разослать").textContent).not.toContain("Принтер");
    expect(cardOf(el, "Собрали, закрыть").textContent).toContain("Кофемашина");
    expect(cardOf(el, "Удалить сбор").textContent).toContain("Кофемашина");
    expect(cardOf(el, "Удалить сбор").textContent).not.toContain("Принтер");

    // Раскрыт второй сбор — первый свернулся, и подписи теперь его.
    const second = [...el.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === "Открыть")[0]!;
    await act(async () => second.click());
    await settle();
    expect(cardOf(el, "Разослать").textContent).toContain("Принтер");
    expect(cardOf(el, "Разослать").textContent).not.toContain("Кофемашина");
    expect(cardOf(el, "Собрали, закрыть").textContent).toContain("Принтер");
    expect(cardOf(el, "Собрали, закрыть").textContent).not.toContain("Кофемашина");
  });

  it("«Удалить сбор» красная: разрушающее действие не должно быть тихо-синим", async () => {
    const el = await mount();
    await openNth(el, 0);
    const del = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Удалить сбор")!;
    expect(del.className).toContain("ui-btn--danger");
    const close = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Собрали, закрыть")!;
    expect(close.className).not.toContain("ui-btn--danger");
  });

  it("кнопка «Открыть»/«Свернуть» у строки сбора сообщает, раскрыта ли она", async () => {
    const el = await mount();
    const toggle = () => [...el.querySelectorAll("button")].filter((b) => b.hasAttribute("aria-expanded"))[0]!;
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    await openNth(el, 0);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("поля дат и сумм переносятся на узком экране и подписаны над полем, а не режутся плавающим заголовком", async () => {
    const el = await mount();
    await openNth(el, 0);
    for (const label of ["Дата события", "Скинуться до", "По сколько", "Нужно всего"]) {
      const input = el.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
      expect(input, label).toBeTruthy();
      const wrap = input.closest("label")!.parentElement as HTMLElement;
      expect(wrap.style.flexWrap, label).toBe("wrap");
      expect(input.closest("label")!.style.minWidth, label).toBe("0px");
    }
  });

  it("карточки открытого сбора лежат в одной обёртке, отдельной от соседнего сбора", async () => {
    const el = await mount();
    await openNth(el, 0);
    const wrapper = cardOf(el, "Собрали, закрыть").closest(".ui-item");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).toContain("ui-item--open");
    expect(cardOf(el, "Разослать").closest(".ui-item")).toBe(wrapper);
    // Соседний сбор — другая обёртка.
    expect(wrapper!.textContent).not.toContain("Принтер");
  });
  it("карточка «Напомнить не сдавшим» несёт название своего сбора", async () => {
    const el = await mount();
    await openNth(el, 0);
    expect(ownerOf(cardOf(el, "Напомнить не сдавшим"))).toBe("Кофемашина");
  });

  it("у сбора с виновником подпись — «повод — имя», а не один повод, во всех четырёх карточках", async () => {
    const el = await mount([row(3, "Свадьба", { personName: "Марк", employeeId: 5 })]);
    await openNth(el, 0);
    for (const label of ["Разослать", "Напомнить не сдавшим", "Собрали, закрыть", "Удалить сбор"]) {
      expect(ownerOf(cardOf(el, label)), label).toBe("Свадьба — Марк");
    }
  });

  it("раунд дня рождения среди сборов: рассылка и закрытие называют ИМЕНИНИКА", async () => {
    const el = await mount([row(4, "День рождения", { personName: "Аня", kind: "birthday", employeeId: 6 })]);
    await openNth(el, 0);
    expect(ownerOf(cardOf(el, "Разослать"))).toBe("День рождения — Аня");
    expect(ownerOf(cardOf(el, "Собрали, закрыть"))).toBe("День рождения — Аня");
  });

  it("карточка рассылки в разделе «Дни рождения» называет именинника", async () => {
    const birthday: UpcomingBirthday = {
      employeeId: 6, displayName: "Аня", birthDate: "09-07", birthDateLabel: "7 сентября",
      celebratedOn: "2099-09-07", daysUntil: 6,
      campaign: row(4, "День рождения", { kind: "birthday", employeeId: 6 }).collection,
    };
    const el = await mount([], [birthday]);
    const open = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Подготовить сбор")!;
    await act(async () => open.click());
    await settle();
    expect(ownerOf(cardOf(el, "Разослать"))).toBe("Аня");
  });
});
