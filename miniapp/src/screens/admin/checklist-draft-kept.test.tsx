// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../../api/client";
import { AdminChecklists } from "./AdminChecklists";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
}

/** Ввод так, чтобы React его увидел: через нативный сеттер и событие input. */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("отказ сервера не стирает набранное название чек-листа", async () => {
  // `run` глотал ошибку и резолвился, и `.then(() => setDraft(""))` чистил поле
  // даже при отказе: название приходилось набирать заново.
  vi.spyOn(apiClient, "getChecklists").mockResolvedValue([]);
  vi.spyOn(apiClient, "getTemplates").mockResolvedValue([]);
  vi.spyOn(apiClient, "getChecklistDay").mockResolvedValue({ date: "2026-08-24", people: [] });
  vi.spyOn(apiClient, "createChecklist").mockRejectedValue(new Error("Такое имя уже есть"));

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(AdminChecklists))); });
  await settle();

  const input = host.querySelector<HTMLInputElement>('input[placeholder="Например, дежурство с 07:00"]')!;
  await act(async () => typeInto(input, "Обход 47-го"));
  const button = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Завести"))!;
  await act(async () => { button.click(); });
  await settle();

  expect(host.textContent ?? "").toContain("Такое имя уже есть");
  expect(host.querySelector<HTMLInputElement>('input[placeholder="Например, дежурство с 07:00"]')!.value).toBe("Обход 47-го");
});
