// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../api/client";
import { JournalScreen } from "./JournalScreen";

/**
 * Фильтр «кто» в консольном «Журнале» должен уходить на сервер — как в мини-аппе —
 * а не резать уже загруженную страницу событий. Сервер сам считает `total` и
 * пагинацию; клиентский фильтр оставил бы их от невыфильтрованного набора.
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
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

async function settle(times = 16) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(JournalScreen));
  });
  await settle();
  return host;
}

function byText(el: HTMLElement, text: string): HTMLElement {
  const found = [...el.querySelectorAll("button")].find((node) => (node.textContent ?? "").trim() === text);
  if (!found) throw new Error(`не нашёл кнопку «${text}»`);
  return found as HTMLElement;
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
  await settle();
}

const PAGE = {
  total: 2, limit: 50, offset: 0,
  availableTypes: ["shift_created"],
  availableActors: [
    { id: 1, displayName: "Иванова Анна" },
    { id: 3, displayName: "Семёнов Марк" },
  ],
  events: [{ id: 1, type: "shift_created", createdAt: "2026-08-20T09:00:00.000Z", actorName: "Иванова Анна", payload: {} }],
};

function actorSelect(el: HTMLElement): HTMLSelectElement {
  const found = el.querySelector<HTMLSelectElement>('select[aria-label="Кто"]');
  if (!found) throw new Error("не нашёл фильтр «кто»");
  return found;
}

function actorOptions(el: HTMLElement): string[] {
  return [...actorSelect(el).options].map((o) => o.text.trim());
}

async function selectActor(el: HTMLElement, name: string) {
  const select = actorSelect(el);
  const option = [...select.options].find((o) => o.text.trim() === name)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, option.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("фильтр «кто» в журнале консоли", () => {
  it("выбор человека уходит в запрос параметром actor, а не фильтруется на клиенте", async () => {
    const get = vi.spyOn(apiClient, "getJournal").mockResolvedValue(PAGE);
    const el = await mount();
    await click(byText(el, "Кто что менял"));
    await selectActor(el, "Семёнов Марк");
    await settle();
    expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ actor: 3 }));
  });

  it("смена человека сбрасывает страницу на первую — иначе offset остался бы от чужого набора", async () => {
    const get = vi.spyOn(apiClient, "getJournal").mockResolvedValue({ ...PAGE, total: 500 });
    const el = await mount();
    await click(byText(el, "Кто что менял"));
    await click(byText(el, "Старее →"));
    await selectActor(el, "Семёнов Марк");
    await settle();
    expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ actor: 3, offset: 0 }));
  });

  it("список «кто» строится из availableActors ответа, а не из ростера", async () => {
    vi.spyOn(apiClient, "getJournal").mockResolvedValue({
      ...PAGE,
      availableActors: [{ id: 3, displayName: "Семёнов Марк" }],
    });
    const el = await mount();
    await click(byText(el, "Кто что менял"));
    expect(actorOptions(el)).toEqual(["Все", "Семёнов Марк"]);
  });
});
