import { describe, it, expect } from "vitest";
import { shiftSchema, shiftTemplateSchema, swapStatusSchema } from "./types";

describe("schemas", () => {
  it("accepts a valid shift", () => {
    const shift = {
      id: 1, date: "2026-07-05", start: "08:00", end: "15:45",
      templateId: 3, title: "Утро", employeeId: 7, note: null,
    };
    expect(shiftSchema.parse(shift)).toEqual(shift);
  });

  it("rejects a malformed time", () => {
    const bad = { id: 1, date: "2026-07-05", start: "8:00", end: "17:00",
      templateId: null, title: null, employeeId: null, note: null };
    expect(shiftSchema.safeParse(bad).success).toBe(false);
  });

  it("resolves the friday override fields on a template", () => {
    const tpl = shiftTemplateSchema.parse({
      id: 3, name: "Утро", start: "08:00", end: "17:00",
      fridayStart: "08:00", fridayEnd: "15:45",
      isLate: false, sendReminder: true, sortOrder: 0, isActive: true,
    });
    expect(tpl.fridayEnd).toBe("15:45");
  });

  it("enumerates swap statuses", () => {
    expect(swapStatusSchema.parse("pending")).toBe("pending");
    expect(swapStatusSchema.safeParse("bogus").success).toBe(false);
  });
});
