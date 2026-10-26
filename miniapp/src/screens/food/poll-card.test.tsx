// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type PollView } from "../../api/client";
import { PollCard } from "./PollCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = null; host = null; vi.restoreAllMocks(); });
async function settle(times = 10) { for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); }
function byText(el: HTMLElement, text: string) {
  return [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
}

async function mountCard(poll: PollView) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(PollCard, { poll }))); });
  await settle();
  return host;
}

const POLL: PollView = {
  id: 5, question: "Пицца?", creatorId: 1, creatorName: "Аня", closesAt: null, closes: null,
  open: true, cancelled: false, isCreator: false, canManage: false, myChoice: null,
  tally: { for: [], against: [], abstain: [], silent: ["Игорь"] }, recipientCount: 2,
};

// Любой отказ — повод перечитать опрос, как делает `OrderScreen`: раньше
// карточка гасила кнопки только по тексту «Опрос закрыт.», а отменённый или
// удалённый опрос оставлял их висеть активными.
describe("PollCard — отказ действия", () => {
  it("отказ голоса (опрос отменили) — текст виден, опрос перечитан, кнопок голоса больше нет", async () => {
    vi.spyOn(apiClient, "votePoll").mockRejectedValue(new Error("Опрос не найден."));
    const getPoll = vi.spyOn(apiClient, "getPoll").mockResolvedValue({ ...POLL, open: false, cancelled: true });
    const el = await mountCard(POLL);
    await act(async () => byText(el, "👍 За")!.click());
    await settle();
    expect(getPoll).toHaveBeenCalledWith(5);
    expect(el.textContent).toContain("Опрос не найден.");
    expect(el.textContent).toContain("Аня · отменён");
    expect(byText(el, "👍 За")).toBeUndefined();
  });

  it("перечитать не вышло — прежняя карточка и текст ошибки остаются", async () => {
    vi.spyOn(apiClient, "votePoll").mockRejectedValue(new Error("Нет сети."));
    vi.spyOn(apiClient, "getPoll").mockRejectedValue(new Error("Нет сети."));
    const el = await mountCard(POLL);
    await act(async () => byText(el, "👍 За")!.click());
    await settle();
    expect(el.textContent).toContain("Нет сети.");
    expect(byText(el, "👍 За")).toBeTruthy();
  });
});

describe("PollCard — выбранный голос", () => {
  it("выбранный вариант помечен aria-pressed=true, остальные — false", async () => {
    const el = await mountCard({ ...POLL, myChoice: "for" });
    const pressed = [...el.querySelectorAll("button[aria-pressed]")].map((b) => [b.textContent?.trim(), b.getAttribute("aria-pressed")]);
    expect(pressed.length).toBeGreaterThanOrEqual(2);
    expect(pressed.filter(([, v]) => v === "true")).toEqual([["👍 За", "true"]]);
    expect(pressed.filter(([, v]) => v === "false")).toHaveLength(pressed.length - 1);
  });
});

describe("PollCard — админ у чужого опроса", () => {
  it("вопрос «Закрыть» называет того, кто спрашивает", async () => {
    const el = await mountCard({ ...POLL, creatorName: "Игорь", isCreator: false, canManage: true });
    await act(async () => byText(el, "Закрыть и разослать итог")!.click());
    expect(el.textContent).toContain("Закрыть чужой опрос (спрашивает Игорь)?");
  });

  it("«Отменить» спрашивает про отмену, а не про закрытие", async () => {
    const el = await mountCard({ ...POLL, creatorName: "Игорь", isCreator: false, canManage: true });
    await act(async () => byText(el, "Отменить")!.click());
    expect(el.textContent).toContain("Отменить чужой опрос (спрашивает Игорь)?");
  });
});

// Кнопка показывается ровно тогда, когда ручка её примет (`canRemindSilent`),
// — иначе карточка обещала бы напоминание, которое не уйдёт.
describe("PollCard — «🔔 Напомнить молчащим»", () => {
  const REMIND = "🔔 Напомнить молчащим";
  const MANAGED: PollView = { ...POLL, isCreator: true, canManage: true, tally: { for: [], against: [], abstain: [], silent: ["Игорь", "Марк"] } };

  it("управляющий, опрос идёт, молчащие есть — кнопка шлёт и пишет «Напомнил: D из N»", async () => {
    const remind = vi.spyOn(apiClient, "remindPollSilent").mockResolvedValue({ delivered: 1, silent: 2, unreachable: ["Марк"] });
    const el = await mountCard(MANAGED);
    await act(async () => byText(el, REMIND)!.click());
    await settle();
    expect(remind).toHaveBeenCalledWith(5);
    expect(el.textContent).toContain("Напомнил: 1 из 2. Не дошло: Марк");
  });

  it("нет кнопки: не управляющий, опрос закрыт, все ответили", async () => {
    for (const over of [
      { canManage: false, isCreator: false },
      { open: false },
      { tally: { for: ["Игорь", "Марк"], against: [], abstain: [], silent: [] } },
    ]) {
      const el = await mountCard({ ...MANAGED, ...over });
      expect(byText(el, REMIND)).toBeUndefined();
      await act(async () => root!.unmount());
      host?.remove();
      root = null;
      host = null;
    }
  });

  it("отказ — текст виден, опрос перечитан: закрытый уже без кнопки", async () => {
    vi.spyOn(apiClient, "remindPollSilent").mockRejectedValue(new Error("Опрос закрыт — напоминать уже не о чем."));
    const getPoll = vi.spyOn(apiClient, "getPoll").mockResolvedValue({ ...MANAGED, open: false });
    const el = await mountCard(MANAGED);
    await act(async () => byText(el, REMIND)!.click());
    await settle();
    expect(getPoll).toHaveBeenCalledWith(5);
    expect(el.textContent).toContain("Опрос закрыт — напоминать уже не о чем.");
    expect(byText(el, REMIND)).toBeUndefined();
  });

  it("новое действие после напоминания убирает старую строку «Напомнил: …»", async () => {
    vi.spyOn(apiClient, "remindPollSilent").mockResolvedValue({ delivered: 2, silent: 2, unreachable: [] });
    vi.spyOn(apiClient, "votePoll").mockResolvedValue({ ...MANAGED, myChoice: "for" });
    const el = await mountCard(MANAGED);
    await act(async () => byText(el, REMIND)!.click());
    await settle();
    expect(el.textContent).toContain("Напомнил: 2 из 2");
    await act(async () => byText(el, "👍 За")!.click());
    await settle();
    expect(el.textContent).not.toContain("Напомнил:");
  });
});
