import { describe, expect, it } from "vitest";
import { installLogTimestamps, logStamp } from "./log-time";

describe("метки времени в логе", () => {
  it("ставит командное время, а не серверное", () => {
    // 09:30 UTC — это 12:30 в Москве; граница «когда сломалось» нужна командная.
    expect(logStamp(new Date("2026-09-24T09:30:05Z"), "Europe/Moscow")).toBe("2026-09-24 12:30:05");
  });

  it("префиксует и log, и error — ошибки идут через error", () => {
    const lines: unknown[][] = [];
    const target = {
      log: (...args: unknown[]) => lines.push(["log", ...args]),
      error: (...args: unknown[]) => lines.push(["error", ...args]),
    };
    installLogTimestamps(target, "Europe/Moscow", () => new Date("2026-09-24T04:03:00Z"));

    target.log("bot started");
    target.error("bot failed:", "409");

    expect(lines).toEqual([
      ["log", "[2026-09-24 07:03:00]", "bot started"],
      ["error", "[2026-09-24 07:03:00]", "bot failed:", "409"],
    ]);
  });
});
