// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type AudienceCandidate, type TeamAudience } from "../api/client";
import { AudiencePicker } from "./AudiencePicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Пять карточек бьют фильтры порознь: Марк не на смене (ловит пропавший
// `onShift`-фильтр), Лена — наблюдатель на смене и Вера — админ на смене: с
// 2026-09-30 обе роли в «на смене»/«все» ВХОДЯТ, и вернувшийся фильтр по роли
// выкинул бы одну из них из точной строки. Дима — на смене, но без Telegram
// (строка «Не дойдёт»).
const TEAM: AudienceCandidate[] = [
  { id: 1, displayName: "Игорь", reachable: true, role: "worker", onShift: true },
  { id: 2, displayName: "Марк", reachable: true, role: "worker", onShift: false },
  { id: 3, displayName: "Лена", reachable: true, role: "observer", onShift: true },
  { id: 4, displayName: "Вера", reachable: true, role: "admin", onShift: true },
  { id: 5, displayName: "Дима", reachable: false, role: "worker", onShift: true },
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
  it("по умолчанию «На смене»: считает только тех, кто сегодня работает, наблюдателя и админа тоже", async () => {
    const el = await mount();
    // Точная строка, а не «contains»: «contains» не поймал бы ни пропавший
    // `onShift`-фильтр (Марк тогда попал бы в список), ни пропавший
    // фильтр роли (Лена), ни лишний фильтр по роли админа (Вера бы исчезла).
    expect(el.textContent).toContain("Уйдёт: Игорь, Лена, Вера и тебе");
    expect(el.textContent).not.toContain("Марк");
    expect(el.textContent).toContain("Не дойдёт: Дима — не привязан(а) к боту");
  });

  it("«Все» отдаёт kind team и зовёт всех — работника не на смене, наблюдателя и админа", async () => {
    const el = await mount();
    await act(async () => byText(el, "Все").click());
    expect(last).toEqual({ kind: "team" });
    expect(el.textContent).toContain("Уйдёт: Игорь, Марк, Лена, Вера и тебе");
    expect(el.textContent).toContain("Не дойдёт: Дима — не привязан(а) к боту");
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
