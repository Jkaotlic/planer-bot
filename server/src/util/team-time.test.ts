import { describe, expect, it } from "vitest";
import { teamTimeAt } from "./team-time";

/**
 * Время события — командное, а не серверное: «ушло в 07:02» админ читает по часам
 * на стене офиса, а не по поясу машины, на которой крутится бот.
 */
describe("teamTimeAt", () => {
  // 2026-08-28 07:02 по Москве.
  const morning = 1787889727;

  it("переводит метку времени в часы команды", () => {
    expect(teamTimeAt(morning, "Europe/Moscow")).toBe("07:02");
  });

  it("тот же момент в другом поясе — другие часы", () => {
    expect(teamTimeAt(morning, "UTC")).toBe("04:02");
  });

  it("полночь не превращается в 24:00", () => {
    // 2026-08-28 00:00 по Москве.
    expect(teamTimeAt(1787864400, "Europe/Moscow")).toBe("00:00");
  });

  // Drizzle отдаёт колонки `mode: "timestamp"` объектом `Date`; считать
  // миллисекунды в уме на каждом вызове — лишний повод ошибиться.
  it("принимает и Date, и секунды — с тем же ответом", () => {
    expect(teamTimeAt(new Date(morning * 1000), "Europe/Moscow")).toBe("07:02");
  });
});
