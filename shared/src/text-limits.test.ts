import { describe, it, expect } from "vitest";
import { tooLongText } from "./text-limits";

describe("tooLongText", () => {
  it("называет поле и потолок", () => {
    expect(tooLongText("Место", 200)).toBe("Место — не длиннее 200 знаков");
  });
});
