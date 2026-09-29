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
