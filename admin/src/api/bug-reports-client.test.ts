import { describe, expect, it } from "vitest";
import { mockGetBugReports, mockResolveBugReport } from "./mock";

describe("мок багрепортов в консоли", () => {
  it("«Новые» не отдаёт разобранные, «Все» отдаёт", async () => {
    const open = await mockGetBugReports("open");
    const all = await mockGetBugReports("all");
    expect(open.every((r) => r.resolvedAt === null)).toBe(true);
    expect(all.length).toBeGreaterThan(open.length);
  });

  it("отметка «Разобрал» проставляет время, снятие — стирает", async () => {
    const [first] = await mockGetBugReports("open");
    const resolved = await mockResolveBugReport(first.id, true);
    expect(resolved.resolvedAt).not.toBeNull();
    const back = await mockResolveBugReport(first.id, false);
    expect(back.resolvedAt).toBeNull();
  });
});
