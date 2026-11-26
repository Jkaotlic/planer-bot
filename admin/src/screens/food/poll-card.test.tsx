// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthRequiredError, apiClient } from "../../api/client";
import { pollView } from "./food-fixtures";
import { authRequired, button, click, deferred, release, maybeButton, mount, unmount, waitFor } from "./food-test-kit";
import { PollCard } from "./PollCard";

afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
});

const card = (el: HTMLElement) => el.querySelector<HTMLElement>(".food-card")!;

describe("консоль: карточка опроса", () => {
  it("итог Telegram показывает свои варианты и обновляет число голосов", async () => {
    const telegram = { options: [{ text: "Парк", count: 1 }, { text: "Музей", count: 2 }], multiple: true, myOptionIds: [0], votedCount: 2, canVote: true };
    const current = pollView({ telegram });
    const refresh = vi.spyOn(apiClient, "getPoll").mockResolvedValue({
      ...current, telegram: { ...telegram, options: [{ text: "Парк", count: 3 }, { text: "Музей", count: 2 }], votedCount: 3 },
    });
    const el = await mount(PollCard, { poll: current });
    expect(el.textContent).toContain("Проголосуй в личном чате с ботом");
    expect(el.textContent).toContain("Ответили: 2");
    expect(el.textContent).toContain("Парк");
    expect(el.textContent).toContain("Твой выбор");
    expect(maybeButton(el, "👍 За")).toBeUndefined();
    expect(maybeButton(el, "🔔 Напомнить молчащим")).not.toBeUndefined();
    await click(button(el, "Обновить итог"));
    await waitFor(() => expect(el.textContent).toContain("Ответили: 3"));
    expect(refresh).toHaveBeenCalledWith(current.id);
  });

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
    await release(slow, pollView({ myChoice: "for" }));
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

it("организатор видит ожидающую, неопределённую и неудавшуюся доставку карточек", async () => {
  const telegram = {
    options: [{ text: "Парк", count: 0 }, { text: "Музей", count: 0 }],
    multiple: false, myOptionIds: [], votedCount: 0, canVote: true,
    delivery: { pending: ["Игорь"], unknown: ["Марк"], failed: ["Дима"] },
  };
  const el = await mount(PollCard, { poll: pollView({ telegram }) });
  expect(el.textContent).toContain("Ожидают отправки: Игорь");
  expect(el.textContent).toContain("Доставка не подтверждена: Марк");
  expect(el.textContent).toContain("Не доставлены: Дима");
});

// Кнопка показывается ровно тогда, когда ручка её примет (`canRemindSilent`),
// — иначе карточка обещала бы напоминание, которое не уйдёт.
describe("консоль: «🔔 Напомнить молчащим»", () => {
  const REMIND = "🔔 Напомнить молчащим";

  it("управляющий, опрос идёт, молчащие есть — кнопка шлёт и пишет «Напомнил: D из N»", async () => {
    const remind = vi.spyOn(apiClient, "remindPollSilent").mockResolvedValue({ delivered: 1, silent: 2, unreachable: ["Марк"] });
    const el = await mount(PollCard, { poll: pollView() });
    await click(button(el, REMIND));
    await waitFor(() => expect(card(el).querySelector('[role="status"]')?.textContent).toBe("Напомнил: 1 из 2. Не дошло: Марк"));
    expect(remind).toHaveBeenCalledWith(3);
  });

  it("нет кнопки: не управляющий, опрос закрыт, все ответили", async () => {
    for (const over of [
      { canManage: false, isCreator: false },
      { open: false },
      { tally: { for: ["Игорь", "Марк"], against: [], abstain: [], silent: [] } },
    ]) {
      const el = await mount(PollCard, { poll: pollView(over) });
      expect(maybeButton(el, REMIND)).toBeUndefined();
      await unmount();
    }
  });

  it("отказ — текстом в карточке, опрос перечитан: закрытый уже без кнопки", async () => {
    vi.spyOn(apiClient, "remindPollSilent").mockRejectedValue(new Error("Опрос закрыт — напоминать уже не о чем."));
    const getPoll = vi.spyOn(apiClient, "getPoll").mockResolvedValue(pollView({ open: false }));
    const el = await mount(PollCard, { poll: pollView() });
    await click(button(el, REMIND));
    await waitFor(() => expect(card(el).querySelector('[role="alert"]')?.textContent).toBe("Опрос закрыт — напоминать уже не о чем."));
    expect(getPoll).toHaveBeenCalledWith(3);
    expect(maybeButton(el, REMIND)).toBeUndefined();
  });

  it("новое действие после напоминания убирает старую строку «Напомнил: …»", async () => {
    vi.spyOn(apiClient, "remindPollSilent").mockResolvedValue({ delivered: 2, silent: 2, unreachable: [] });
    vi.spyOn(apiClient, "votePoll").mockResolvedValue(pollView({ myChoice: "for" }));
    const el = await mount(PollCard, { poll: pollView() });
    await click(button(el, REMIND));
    await waitFor(() => expect(card(el).querySelector('[role="status"]')?.textContent).toBe("Напомнил: 2 из 2"));
    await click(button(el, "👍 За"));
    await waitFor(() => expect(button(el, "👍 За").getAttribute("aria-pressed")).toBe("true"));
    expect(card(el).querySelector('[role="status"]')).toBeNull();
  });
});
