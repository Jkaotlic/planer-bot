import { describe, expect, it } from "vitest";
import type { PersonKindRole } from "@planer/shared";
import { personSummary } from "./AdminShiftKinds";

const role = (patch: Partial<PersonKindRole>): PersonKindRole => ({
  templateId: 1, name: "Утро", allowed: true, preferred: false, poolIsEmpty: true, ...patch,
});

describe("personSummary", () => {
  it("считает допущенные виды, а не отмеченные вручную", () => {
    // Пустой список допущенных — это «могут все», и в сводке человека он обязан
    // считаться допуском: иначе экран читался бы как «Игорь не может ничего».
    expect(personSummary([role({}), role({ templateId: 2, name: "Дежурство", allowed: false, poolIsEmpty: false })]))
      .toBe("допущен к 1 из 2");
  });

  it("говорит «ко всем», когда допущен везде", () => {
    expect(personSummary([role({}), role({ templateId: 2, allowed: true, poolIsEmpty: false })]))
      .toBe("допущен ко всем (2)");
  });

  it("считает «любит» отдельной строкой", () => {
    expect(personSummary([role({ preferred: true }), role({ templateId: 2, allowed: false, poolIsEmpty: false })]))
      .toBe("допущен к 1 из 2 · любит: 1");
  });

  it("без видов смен ничего не выдумывает", () => {
    expect(personSummary([])).toBe("видов смен пока нет");
  });
});
