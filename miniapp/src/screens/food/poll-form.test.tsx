// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../../api/client";
import { PollForm } from "./PollForm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = null; host = null; vi.restoreAllMocks(); });
async function settle(times = 10) { for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); }
function byText(el: HTMLElement, text: string) {
  return [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
}
function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function mount(onDone = vi.fn()) {
  vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue([{ id: 2, displayName: "Игорь", reachable: true, role: "worker", onShift: true }]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(PollForm, { onDone, onCancel: vi.fn() }))); });
  await settle();
  return { el: host, onDone };
}

describe("PollForm", () => {
  it("кнопка «Отправить» неактивна, пока нет вопроса", async () => {
    const { el } = await mount();
    expect(byText(el, "Отправить").disabled).toBe(true);
  });

  it("отправляет вопрос, срок и адресатов «на смене»", async () => {
    const create = vi.spyOn(apiClient, "createPoll").mockResolvedValue({ poll: {} as never, delivered: 2, unreachable: [] });
    const { el, onDone } = await mount();
    await act(async () => type(el.querySelector("textarea")!, "Корпоратив в пятницу?"));
    await act(async () => type(el.querySelector<HTMLInputElement>("input[type=time]")!, "18:00"));
    await act(async () => byText(el, "Отправить").click());
    await settle();
    expect(create).toHaveBeenCalledWith({ question: "Корпоратив в пятницу?", closesTime: "18:00", audience: { kind: "on_shift" } });
    expect(onDone).toHaveBeenCalled();
  });

  it("ошибка сервера показывается текстом, форма не закрывается", async () => {
    vi.spyOn(apiClient, "createPoll").mockRejectedValue(new Error("Некому отправить: в списке никого, кроме тебя."));
    const { el, onDone } = await mount();
    await act(async () => type(el.querySelector("textarea")!, "?"));
    await act(async () => byText(el, "Отправить").click());
    await settle();
    expect(el.textContent).toContain("Некому отправить");
    expect(onDone).not.toHaveBeenCalled();
  });
});
