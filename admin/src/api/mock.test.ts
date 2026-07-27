import { describe, expect, it } from "vitest";
import { TEMPLATES } from "./mock";

describe("admin schedule mock", () => {
  it("mirrors the renamed 07:00 duty preset used by the real API", () => {
    expect(TEMPLATES.find((template) => template.id === 6)).toMatchObject({
      id: 6,
      name: "Дежурство с 07:00",
      category: "duty",
      accent: "amber",
      start: "07:00",
      end: "16:00",
      fridayStart: "07:00",
      fridayEnd: "14:45",
    });
  });
});
