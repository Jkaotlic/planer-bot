// @vitest-environment jsdom
import { createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamAudience } from "@planer/shared";
import { apiClient } from "../../api/client";
import { AudiencePicker } from "./AudiencePicker";
import { TEAM } from "./food-fixtures";
import { button, click, mount, unmount, waitFor } from "./food-test-kit";

afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
});

let last: TeamAudience | null = null;
function Harness() {
  const [value, setValue] = useState<TeamAudience>({ kind: "on_shift" });
  return createElement(AudiencePicker, { value, onChange: (next) => { last = next; setValue(next); }, onAuthRequired: () => {} });
}

async function mountPicker() {
  vi.spyOn(apiClient, "getTeamAudience").mockResolvedValue(TEAM);
  vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue([{ id: 1, name: "Кухня", memberIds: [2, 3, 99] }]);
  const el = await mount(Harness, {});
  await waitFor(() => expect(el.textContent).toContain("Уйдёт:"));
  return el;
}

describe("консоль: кому уйдёт опрос или заказ", () => {
  it("«На смене» по умолчанию: кому уйдёт, копия наблюдателю, кому не дойдёт", async () => {
    const el = await mountPicker();
    expect(el.textContent).toContain("Уйдёт: Игорь и тебе");
    expect(el.textContent).toContain("Наблюдателям — копия всегда: Лена");
    expect(el.querySelector(".food-unreachable")?.textContent).toBe("Не дойдёт: Дима — не привязан(а) к боту");
  });

  it("«Все» — наблюдатель среди адресатов, отдельной строки про копию нет", async () => {
    const el = await mountPicker();
    await click(button(el, "Все"));
    expect(el.textContent).toContain("Уйдёт: Игорь, Марк, Лена и тебе");
    expect(el.textContent).not.toContain("Наблюдателям — копия всегда");
  });

  it("«Выбрать» и галочка — выбранный уходит наверх, остальные нет", async () => {
    const el = await mountPicker();
    await click(button(el, "Выбрать"));
    expect(el.textContent).toContain("Пока никого, кроме тебя.");
    const igor = [...el.querySelectorAll("label")].find((l) => l.textContent?.includes("Игорь"))!.querySelector("input")!;
    await click(igor);
    expect(last).toEqual({ kind: "picked", employeeIds: [2] });
    expect(el.textContent).toContain("Уйдёт: Игорь и тебе");
  });

  it("группа отмечает своих — чужой id из группы (уволенный) не попадает", async () => {
    const el = await mountPicker();
    await click(button(el, "Кухня"));
    expect(last).toEqual({ kind: "picked", employeeIds: [2, 3] });
    expect(button(el, "Кухня").getAttribute("aria-pressed")).toBe("true");
  });

  it("команда не загрузилась — текст ошибки вместо выбора", async () => {
    vi.spyOn(apiClient, "getTeamAudience").mockRejectedValue(new Error("Нет связи с сервером — проверь интернет и попробуй ещё раз."));
    vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue([]);
    const el = await mount(Harness, {});
    await waitFor(() => expect(el.querySelector('[role="alert"]')?.textContent).toContain("Нет связи с сервером"));
  });
});
