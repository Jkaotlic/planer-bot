// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthRequiredError, apiClient } from "../../api/client";
import { pollView } from "./food-fixtures";
import { button, click, maybeButton, mount, unmount, waitFor } from "./food-test-kit";
import { PollCard } from "./PollCard";

afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
});

const card = (el: HTMLElement) => el.querySelector<HTMLElement>(".food-card")!;

describe("консоль: карточка опроса", () => {
  it("голос уходит с выбором, нажатая кнопка помечена, итог поимённо", async () => {
    const vote = vi.spyOn(apiClient, "votePoll").mockResolvedValue(
      pollView({ myChoice: "for", tally: { for: ["Аня"], against: [], abstain: [], silent: ["Игорь"] } }),
    );
    const el = await mount(PollCard, { poll: pollView(), onAuthRequired: vi.fn() });
    expect(el.textContent).toContain("Не ответили — 2: Игорь, Марк");
    await click(button(el, "👍 За"));
    await waitFor(() => expect(button(el, "👍 За").getAttribute("aria-pressed")).toBe("true"));
    expect(vote).toHaveBeenCalledWith(3, "for");
    expect(el.textContent).toContain("👍 За — 1: Аня");
  });

  it("отказ сервера — текстом внутри карточки, опрос перечитан, кнопки голоса погасли", async () => {
    vi.spyOn(apiClient, "votePoll").mockRejectedValue(new Error("Опрос закрыт."));
    const getPoll = vi.spyOn(apiClient, "getPoll").mockResolvedValue(pollView({ open: false }));
    const el = await mount(PollCard, { poll: pollView(), onAuthRequired: vi.fn() });
    await click(button(el, "👎 Против"));
    await waitFor(() => expect(card(el).querySelector('[role="alert"]')?.textContent).toBe("Опрос закрыт."));
    expect(getPoll).toHaveBeenCalledWith(3);
    expect(maybeButton(el, "👎 Против")).toBeUndefined();
    expect(card(el).textContent).toContain("закрыт");
  });

  it("чужой опрос: вопрос называет того, кто спрашивает; закрытие уходит после второго клика", async () => {
    const close = vi.spyOn(apiClient, "closePoll").mockResolvedValue(pollView({ open: false, isCreator: false, creatorName: "Игорь" }));
    const el = await mount(PollCard, { poll: pollView({ isCreator: false, creatorName: "Игорь" }), onAuthRequired: vi.fn() });
    await click(button(el, "Закрыть и разослать итог"));
    expect(close).not.toHaveBeenCalled();
    expect(el.textContent).toContain("Закрыть чужой опрос (спрашивает Игорь)?");
    await click(button(el, "Закрыть"));
    await waitFor(() => expect(close).toHaveBeenCalledWith(3));
  });

  it("без права управлять — ни «Закрыть», ни «Отменить»", async () => {
    const el = await mount(PollCard, { poll: pollView({ canManage: false, isCreator: false }), onAuthRequired: vi.fn() });
    expect(maybeButton(el, "Закрыть и разослать итог")).toBeUndefined();
    expect(maybeButton(el, "Отменить")).toBeUndefined();
  });

  it("истёкшая сессия — вход, а не красная плашка", async () => {
    vi.spyOn(apiClient, "votePoll").mockRejectedValue(new AuthRequiredError("Сессия истекла — войди заново"));
    vi.spyOn(apiClient, "getPoll").mockResolvedValue(pollView());
    const onAuth = vi.fn();
    const el = await mount(PollCard, { poll: pollView(), onAuthRequired: onAuth });
    await click(button(el, "👍 За"));
    await waitFor(() => expect(onAuth).toHaveBeenCalled());
    expect(card(el).querySelector('[role="alert"]')).toBeNull();
  });
});
