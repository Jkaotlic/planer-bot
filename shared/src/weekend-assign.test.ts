import { describe, it, expect } from "vitest";
import { ASSIGN_REFUSAL_TEXT, weekendBusyRefusal } from "./weekend-assign";

describe("отказы назначения на выходной", () => {
  it("занятой: без падежа после «У» — имя в именительном читается грамотно", () => {
    expect(weekendBusyRefusal("Игорь Петров", "Сб 18 июл · 09:00–12:00 · Утро")).toBe(
      "Игорь Петров в это время уже занят(а): Сб 18 июл · 09:00–12:00 · Утро",
    );
  });

  it("у каждого кода — русская фраза, а не код", () => {
    for (const [code, text] of Object.entries(ASSIGN_REFUSAL_TEXT)) {
      expect(text, code).toMatch(/^[А-ЯЁ]/);
      expect(text, code).not.toContain("_");
    }
  });
});
