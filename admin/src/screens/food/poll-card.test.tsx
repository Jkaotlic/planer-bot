// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthRequiredError, apiClient } from "../../api/client";
import { pollView } from "./food-fixtures";
import { authRequired, button, click, deferred, maybeButton, mount, unmount, waitFor } from "./food-test-kit";
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
    const el = await mount(PollCard, { poll: pollView() });
    expect(el.textContent).toContain("Не ответили — 2: Игорь, Марк");
    await click(button(el, "👍 За"));
    await waitFor(() => expect(button(el, "👍 За").getAttribute("aria-pressed")).toBe("true"));
    expect(vote).toHaveBeenCalledWith(3, "for");
    expect(el.textContent).toContain("👍 За — 1: Аня");
  });

  it("отказ сервера — текстом внутри карточки, опрос перечитан, кнопки голоса погасли", async () => {
    vi.spyOn(apiClient, "votePoll").mockRejectedValue(new Error("Опрос закрыт."));
    const getPoll = vi.spyOn(apiClient, "getPoll").mockResolvedValue(pollView({ open: false }));
    const el = await mount(PollCard, { poll: pollView() });
    await click(button(el, "👎 Против"));
    await waitFor(() => expect(card(el).querySelector('[role="alert"]')?.textContent).toBe("Опрос закрыт."));
    expect(getPoll).toHaveBeenCalledWith(3);
    expect(maybeButton(el, "👎 Против")).toBeUndefined();
    expect(card(el).textContent).toContain("закрыт");
  });

  it("чужой опрос: вопрос называет того, кто спрашивает; закрытие уходит после второго клика", async () => {
    const close = vi.spyOn(apiClient, "closePoll").mockResolvedValue(pollView({ open: false, isCreator: false, creatorName: "Игорь" }));
    const el = await mount(PollCard, { poll: pollView({ isCreator: false, creatorName: "Игорь" }) });
    await click(button(el, "Закрыть и разослать итог"));
    expect(close).not.toHaveBeenCalled();
    expect(el.textContent).toContain("Закрыть чужой опрос (спрашивает Игорь)?");
    await click(button(el, "Закрыть"));
    await waitFor(() => expect(close).toHaveBeenCalledWith(3));
  });

  it("без права управлять — ни «Закрыть», ни «Отменить»", async () => {
    const el = await mount(PollCard, { poll: pollView({ canManage: false, isCreator: false }) });
    expect(maybeButton(el, "Закрыть и разослать итог")).toBeUndefined();
    expect(maybeButton(el, "Отменить")).toBeUndefined();
  });

  it("истёкшая сессия — вход, а не красная плашка", async () => {
    vi.spyOn(apiClient, "votePoll").mockRejectedValue(new AuthRequiredError("Сессия истекла — войди заново"));
    vi.spyOn(apiClient, "getPoll").mockResolvedValue(pollView());
    const el = await mount(PollCard, { poll: pollView() });
    await click(button(el, "👍 За"));
    await waitFor(() => expect(authRequired).toHaveBeenCalled());
    expect(card(el).querySelector('[role="alert"]')).toBeNull();
  });

  it("двойной клик по голосу, пока первый идёт, — один запрос", async () => {
    const slow = deferred<ReturnType<typeof pollView>>();
    const vote = vi.spyOn(apiClient, "votePoll").mockReturnValue(slow.promise);
    const el = await mount(PollCard, { poll: pollView() });
    await click(button(el, "👍 За"));
    await click(button(el, "👍 За"));
    expect(vote).toHaveBeenCalledTimes(1);
    slow.resolve(pollView({ myChoice: "for" }));
  });

  it("«Отменить» — после подтверждения шлёт cancelPoll", async () => {
    const cancel = vi.spyOn(apiClient, "cancelPoll").mockResolvedValue(pollView({ open: false, cancelled: true }));
    const el = await mount(PollCard, { poll: pollView() });
    await click(button(el, "Отменить"));
    expect(cancel).not.toHaveBeenCalled();
    await click(button(el, "Отменить"));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(3));
  });
});
