// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type AudienceCandidate, type TeamAudience } from "../api/client";
import { AudiencePicker } from "./AudiencePicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEAM: AudienceCandidate[] = [
  { id: 1, displayName: "Игорь", reachable: true, role: "worker", onShift: true },
  { id: 2, displayName: "Марк", reachable: true, role: "worker", onShift: false },
  { id: 3, displayName: "Лена", reachable: false, role: "observer", onShift: true },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let last: TeamAudience | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove(); root = null; host = null; last = null;
  vi.restoreAllMocks();
});

async function settle(times = 10) {
  for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

function byText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`нет кнопки «${text}»`);
  return found as HTMLButtonElement;
}

function Harness() {
  const [value, setValue] = useState<TeamAudience>({ kind: "on_shift" });
  return createElement(AudiencePicker, { value, onChange: (next: TeamAudience) => { last = next; setValue(next); } });
}

async function mount() {
  vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue(TEAM);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(Harness))); });
  await settle();
  return host;
}

describe("AudiencePicker", () => {
  it("по умолчанию «Сегодня на смене» и показывает, кто это, — без наблюдателя", async () => {
    const el = await mount();
    expect(el.textContent).toContain("Уйдёт: Игорь");
    expect(el.textContent).not.toContain("Лена");
  });

  it("«Вся команда» отдаёт kind team", async () => {
    const el = await mount();
    await act(async () => byText(el, "Вся команда").click());
    expect(last).toEqual({ kind: "team" });
  });

  it("«Выбрать» даёт галочки, и отмеченные уходят списком id; без Telegram помечен", async () => {
    const el = await mount();
    await act(async () => byText(el, "Выбрать").click());
    expect(el.textContent).toContain("— не привязан");
    const boxes = [...el.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    await act(async () => boxes[1]!.click());
    expect(last).toEqual({ kind: "picked", employeeIds: [2] });
  });
});
