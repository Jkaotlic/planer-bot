import { describe, it, expect } from "vitest";
import { swapUndeliveredNotice } from "./swap-notice";

describe("swapUndeliveredNotice", () => {
  it("не дошло — называет коллегу и просит сказать лично", () => {
    const text = swapUndeliveredNotice(false, "Игорь");
    expect(text).toContain("Игорь");
    expect(text).toContain("скажи лично");
  });
  it("дошло — молчит", () => {
    expect(swapUndeliveredNotice(true, "Игорь")).toBeNull();
  });
});
