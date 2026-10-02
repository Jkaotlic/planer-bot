// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot, List, Section } from "@telegram-apps/telegram-ui";
import { apiClient, type Collection, type CollectionRow, type Me, type UpcomingBirthday } from "../../api/client";
import { CollectionsTabScreen } from "../CollectionsTabScreen";

/**
 * Вид админской вкладки «Сборы»: один заголовок, одна главная кнопка на карточку,
 * никакого `Section` telegram-ui. Логику экрана держат тесты `AdminCollections-*`;
 * здесь — только то, что вид собран из общего набора и не расползся обратно.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE: Collection = {
  id: 3, kind: "custom", employeeId: null, year: null, celebratedOn: null,
  title: "Кофемашина", eventDate: null, deadline: null, amountPerPerson: null, totalGoal: null,
  collectUrl: "https://example.com/pay", messageText: null, closedAt: null,
  scheduledSendOn: null, scheduleNotifiedAt: null, autoSendOn: null, autoSentAt: null, sentAt: null, sentCount: 0, sendCount: 0,
  recipientGroupId: null, createdAt: "2026-08-01T10:00:00Z",
};
const RUNNING: CollectionRow = { collection: BASE, personName: null, title: "Кофемашина", status: "ready", active: true };
// Закрытый нужен, чтобы открыть архив: у него был собственный `Section`.
const CLOSED: CollectionRow = {
  collection: { ...BASE, id: 4, title: "Плед", closedAt: "2026-08-10T10:00:00Z" },
  personName: null, title: "Плед", status: "ready", active: false,
};
const BIRTHDAY: UpcomingBirthday = {
  employeeId: 1, displayName: "Аня", birthDate: "08-25", birthDateLabel: "25 августа",
  celebratedOn: "2026-08-25", daysUntil: 4, campaign: null,
};
const ME: Me = {
  id: 9, displayName: "Игорь", address: "Игорь", preferredName: null,
  isAdmin: true, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, startTab: null, canAnnounce: true,
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
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

async function render(node: ReturnType<typeof createElement>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, node));
  });
  await settle();
  return host;
}

async function mountTab() {
  vi.spyOn(apiClient, "getBirthdays").mockResolvedValue([BIRTHDAY]);
  vi.spyOn(apiClient, "getCollections").mockResolvedValue([RUNNING, CLOSED]);
  vi.spyOn(apiClient, "getMe").mockResolvedValue(ME);
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([]);
  vi.spyOn(apiClient, "getCollectionPreview").mockResolvedValue({
    id: 3, message: "Скидываемся", recipients: [], blocker: null, sendCount: 0, lastSentAt: null,
    recipientGroupName: null,
  } as never);
  vi.spyOn(apiClient, "getCollectionPayments").mockResolvedValue({ rows: [], paidCount: 0, total: 0 } as never);
  return render(createElement(CollectionsTabScreen, { isAdmin: true, today: "2026-01-01" }));
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle(3);
}

function buttonByText(scope: ParentNode, text: string): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`нет кнопки «${text}»`);
  return found as HTMLButtonElement;
}

describe("админская вкладка «Сборы» на общих деталях", () => {
  it("один заголовок h1 «Сборы» — его даёт общий Screen, а не вёрстка вручную", async () => {
    const el = await mountTab();
    const titles = el.querySelectorAll("h1");
    expect(titles).toHaveLength(1);
    expect(titles[0]!.textContent).toBe("Сборы");
  });

  it("у карточки идущего сбора одна главная кнопка — «Собрали»", async () => {
    const el = await mountTab();
    const card = buttonByText(el, "Собрали").closest(".ui-card")!;
    const primaries = card.querySelectorAll(".ui-btn--primary");
    expect(primaries).toHaveLength(1);
    expect(primaries[0]!.textContent?.trim()).toBe("Собрали");
    // «Открыть» и «Копировать» в той же карточке — обычные.
    expect(buttonByText(card, "Открыть").classList.contains("ui-btn--primary")).toBe(false);
    expect(buttonByText(card, "Копировать").classList.contains("ui-btn--primary")).toBe(false);
  });

  it("раскрытый сбор не добавляет второй главной кнопки в ту же карточку", async () => {
    const el = await mountTab();
    await click(buttonByText(el, "Открыть"));
    for (const card of Array.from(el.querySelectorAll(".ui-card"))) {
      expect(card.querySelectorAll(".ui-btn--primary").length).toBeLessThanOrEqual(1);
    }
    // «Сохранить» редактора — главная своей карточки, не карточки со «Собрали».
    const saveCard = buttonByText(el, "Сохранить").closest(".ui-card")!;
    expect(saveCard.contains(buttonByText(el, "Собрали"))).toBe(false);
  });

  it("Section telegram-ui не остаётся нигде, и в раскрытом архиве тоже", async () => {
    // Маркер не зашит в тест: `Section` рисует `<section>` с хешированными
    // классами CSS-модуля (`tgui-3dfa…`), и угадывать их незачем — класс берём
    // с настоящего эталона из той же сборки. Наш `Group` — тоже `<section>`,
    // но с классом `ui-group`, поэтому по тегу одному их не различить.
    const reference = await render(createElement(List, null, createElement(Section, { header: "эталон" }, "x")));
    const sectionClass = reference.querySelector("section")!.className.split(/\s+/)[0]!;
    expect(sectionClass).toMatch(/^tgui-/);
    await act(async () => root!.unmount());
    host?.remove();
    root = null;
    host = null;

    const el = await mountTab();
    await click(buttonByText(el, "Показать · 1"));
    expect(el.textContent).toContain("Плед");
    expect(el.querySelector(`.${CSS.escape(sectionClass)}`)).toBeNull();
    // Тот же запрет с другой стороны: секция без `ui-group` — чужая.
    expect(el.querySelector("section:not(.ui-group)")).toBeNull();
  });
});
