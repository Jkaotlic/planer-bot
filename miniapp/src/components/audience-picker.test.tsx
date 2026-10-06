// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type AudienceCandidate, type RecipientGroupView, type TeamAudience } from "../api/client";
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

async function mount(groups: RecipientGroupView[] = []) {
  vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue(TEAM);
  vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue(groups);
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

  // memberIds группы шире списка команды (id 99 — не из этого выбора): галочки
  // ставятся только тем, кто загружен, иначе в `employeeIds` уехал бы чужой id.
  it("кнопка группы включает «Выбрать» с её составом и подсвечивается; ручная галочка подсветку снимает", async () => {
    const el = await mount([{ id: 7, name: "ЧИП 5-й этаж", memberIds: [2, 3, 99] }]);
    // Классы telegram-ui хешированы — подсветку ловим сменой className.
    expect(el.querySelector("[data-testid=group-row]")).not.toBeNull();
    const idle = byText(el, "ЧИП 5-й этаж").className;
    await act(async () => byText(el, "ЧИП 5-й этаж").click());
    expect(last).toEqual({ kind: "picked", employeeIds: [2, 3] });
    expect(el.textContent).toContain("Уйдёт: Марк, Лена и тебе");
    expect(byText(el, "ЧИП 5-й этаж").className).not.toBe(idle);
    const boxes = [...el.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    await act(async () => boxes[0]!.click());
    expect(byText(el, "ЧИП 5-й этаж").className).toBe(idle);
  });

  it("без групп ряда нет, и сбой загрузки групп выбор не ломает", async () => {
    let el = await mount([]);
    expect(el.querySelector("[data-testid=group-row]")).toBeNull();
    await act(async () => root!.unmount()); host!.remove(); root = null;
    vi.restoreAllMocks();
    vi.spyOn(apiClient, "getRecipientGroups").mockRejectedValue(new Error("сеть"));
    vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue(TEAM);
    host = document.createElement("div"); document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(AppRoot, null, createElement(Harness))); });
    await settle();
    el = host;
    expect(el.querySelector("[data-testid=group-row]")).toBeNull();
    expect(el.textContent).toContain("Уйдёт: Игорь, Лена, Вера и тебе");
  });

  it("наблюдатель, которого нет в выбранных, назван отдельной строкой: копия ему уходит всегда", async () => {
    const el = await mount();
    await act(async () => byText(el, "Выбрать").click());
    await settle(3);
    const box = [...el.querySelectorAll("input[type=checkbox]")] as HTMLInputElement[];
    await act(async () => box[0]!.click()); // Игорь
    await settle(3);
    const text = el.textContent ?? "";
    expect(text).toContain("Уйдёт: Игорь и тебе");
    expect(text).toContain("Наблюдателям — копия всегда: Лена");
  });

  it("наблюдатель уже среди адресатов — отдельной строки нет", async () => {
    const el = await mount();
    await act(async () => byText(el, "Все").click());
    await settle(3);
    expect(el.textContent ?? "").not.toContain("Наблюдателям — копия всегда");
  });
});
