// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_QUESTION_MAX } from "@planer/shared";
import { AuthRequiredError, apiClient } from "../../api/client";
import { TEAM, pollView } from "./food-fixtures";
import { button, click, deferred, mount, type, unmount, waitFor } from "./food-test-kit";
import { PollForm } from "./PollForm";

beforeEach(() => {
  vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue(TEAM);
  vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue([]);
});
afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
});

const props = () => ({ onDone: vi.fn(), onCancel: vi.fn(), onAuthRequired: vi.fn() });
const question = (el: HTMLElement) => el.querySelector<HTMLTextAreaElement>('textarea[aria-label="Вопрос"]')!;

describe("консоль: новый опрос", () => {
  it("вопрос, срок и адресаты уходят одним телом; ответы перечислены подсказкой", async () => {
    const create = vi.spyOn(apiClient, "createPoll").mockResolvedValue({ poll: pollView(), delivered: 2, unreachable: [] });
    const p = props();
    const el = await mount(PollForm, p);
    expect(el.textContent).toContain("Ответы: 👍 За · 👎 Против · 🤷 Воздержался");
    expect(question(el).maxLength).toBe(POLL_QUESTION_MAX);
    await type(question(el), "  Корпоратив в пятницу?  ");
    await type(el.querySelector<HTMLInputElement>('input[aria-label="Голосуем до"]')!, "18:00");
    await waitFor(() => expect(el.textContent).toContain("Уйдёт:"));
    await click(button(el, "Отправить"));
    await waitFor(() => expect(p.onDone).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith({ question: "Корпоратив в пятницу?", closesTime: "18:00", audience: { kind: "on_shift" } });
  });

  it("пустой вопрос — «Отправить» погашена", async () => {
    const el = await mount(PollForm, props());
    await waitFor(() => expect(el.textContent).toContain("Уйдёт:"));
    await type(question(el), "   ");
    expect(button(el, "Отправить").disabled).toBe(true);
  });

  it("дошло не всем — отчёт и «ОК»", async () => {
    vi.spyOn(apiClient, "createPoll").mockResolvedValue({ poll: pollView(), delivered: 2, unreachable: ["Дима"] });
    const p = props();
    const el = await mount(PollForm, p);
    await type(question(el), "Обед?");
    await waitFor(() => expect(el.textContent).toContain("Уйдёт:"));
    await click(button(el, "Отправить"));
    await waitFor(() => expect(el.textContent).toContain("Отправлено: 2. Не дошло: Дима"));
    expect(p.onDone).not.toHaveBeenCalled();
    await click(button(el, "ОК"));
    expect(p.onDone).toHaveBeenCalled();
  });

  it("отказ сервера — прямо над «Отправить»", async () => {
    vi.spyOn(apiClient, "createPoll").mockRejectedValue(new Error("Время уже прошло — поставь позже или оставь пустым."));
    const el = await mount(PollForm, props());
    await type(question(el), "Обед?");
    await waitFor(() => expect(el.textContent).toContain("Уйдёт:"));
    await click(button(el, "Отправить"));
    await waitFor(() => expect(el.querySelector('[role="alert"]')).not.toBeNull());
    const alert = el.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.textContent).toBe("Время уже прошло — поставь позже или оставь пустым.");
    expect(alert.nextElementSibling?.contains(button(el, "Отправить"))).toBe(true);
  });

  it("двойной клик по «Отправить», пока первый идёт, — один опрос, а не два", async () => {
    const slow = deferred<{ poll: ReturnType<typeof pollView>; delivered: number; unreachable: string[] }>();
    const create = vi.spyOn(apiClient, "createPoll").mockReturnValue(slow.promise);
    const el = await mount(PollForm, props());
    await type(question(el), "Обед?");
    await waitFor(() => expect(el.textContent).toContain("Уйдёт:"));
    await click(button(el, "Отправить"));
    await click(button(el, "Отправляю…"));
    expect(create).toHaveBeenCalledTimes(1);
    slow.resolve({ poll: pollView(), delivered: 2, unreachable: [] });
  });

  it("истёкшая сессия при отправке — вход, а не красная плашка", async () => {
    vi.spyOn(apiClient, "createPoll").mockRejectedValue(new AuthRequiredError("Сессия истекла — войди заново"));
    const p = props();
    const el = await mount(PollForm, p);
    await type(question(el), "Обед?");
    await waitFor(() => expect(el.textContent).toContain("Уйдёт:"));
    await click(button(el, "Отправить"));
    await waitFor(() => expect(p.onAuthRequired).toHaveBeenCalled());
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });
});
