import { describe, it, expect } from "vitest";
import { createEntrySchema, updateEntrySchema } from "./entry-schema";

describe("entry input schema", () => {
  it("parses a regular shift with a template", () => {
    const r = createEntrySchema.parse({ date: "2026-07-10", start: "08:00", end: "17:00", employeeId: 5, templateId: 1 });
    expect(r.category).toBe("shift"); // default
    expect(r.employeeId).toBe(5);
  });

  it("parses an all-day vacation with a range and no times", () => {
    const r = createEntrySchema.parse({ date: "2026-07-10", endDate: "2026-07-20", category: "vacation" });
    expect(r.category).toBe("vacation");
    expect(r.endDate).toBe("2026-07-20");
  });

  it("rejects a bad category, date, or time", () => {
    expect(createEntrySchema.safeParse({ date: "2026-07-10", category: "bogus" }).success).toBe(false);
    expect(createEntrySchema.safeParse({ date: "10-07-2026" }).success).toBe(false);
    expect(createEntrySchema.safeParse({ date: "2026-07-10", start: "8am" }).success).toBe(false);
  });

  it("update schema makes everything optional", () => {
    expect(updateEntrySchema.parse({ note: "заметка" })).toEqual({ note: "заметка" });
  });

  it("rejects a shift with no times", () => {
    expect(createEntrySchema.safeParse({ date: "2026-07-10" }).success).toBe(false);
  });

  it("accepts a shift with times", () => {
    expect(createEntrySchema.safeParse({ date: "2026-07-10", start: "08:00", end: "17:00" }).success).toBe(true);
  });

  it("rejects an absence that has times", () => {
    expect(
      createEntrySchema.safeParse({ date: "2026-07-10", category: "vacation", start: "08:00", end: "17:00" }).success,
    ).toBe(false);
  });

  it("accepts a duty with times", () => {
    expect(
      createEntrySchema.safeParse({ date: "2026-07-10", category: "duty", start: "09:00", end: "18:00", location: "Вавилова" })
        .success,
    ).toBe(true);
  });
});
