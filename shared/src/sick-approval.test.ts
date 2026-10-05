import { describe, expect, it } from "vitest";
import { sickSpanShort, sickSpanWords } from "./sick-approval";

describe("слова про срок больничного", () => {
  it("в письме работнику — полными словами, месяц один раз", () => {
    expect(sickSpanWords("2026-10-06", "2026-10-08")).toBe("с 6 по 8 октября");
    expect(sickSpanWords("2026-09-30", "2026-10-02")).toBe("с 30 сентября по 2 октября");
    expect(sickSpanWords("2026-10-06", null)).toBe("на 6 октября");
    expect(sickSpanWords("2026-10-06", "2026-10-06")).toBe("на 6 октября");
  });

  it("в письме админам — коротко", () => {
    expect(sickSpanShort("2026-10-06", "2026-10-08")).toBe("6–8 окт.");
    expect(sickSpanShort("2026-09-30", "2026-10-02")).toBe("30 сент. – 2 окт.");
    expect(sickSpanShort("2026-10-06", null)).toBe("6 окт.");
  });
});
