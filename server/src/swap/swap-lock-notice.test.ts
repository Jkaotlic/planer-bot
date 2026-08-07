import { describe, it, expect } from "vitest";
import { buildSwapLockNotices, buildExclusionNotices } from "./swap-lock-notice";
import type { SwapAuditPayload } from "../util/message-lines";

const ANYA = { id: 1, telegramUserId: 1001 };
const IGOR = { id: 2, telegramUserId: 1002 };
const MARK = { id: 3, telegramUserId: null };

const trade = (over: Partial<SwapAuditPayload> = {}): SwapAuditPayload => ({
  requestId: 10,
  fromEmployeeId: ANYA.id, fromName: "Аня Смирнова", fromShift: "Чт 13 авг · 09:00–18:00",
  toEmployeeId: IGOR.id, toName: "Игорь Петров", toShift: "Чт 13 авг · 12:00–21:00",
  ...over,
});

describe("buildSwapLockNotices", () => {
  it("tells the whole reachable team that swaps are closed", () => {
    const notices = buildSwapLockNotices({ locked: true, team: [ANYA, IGOR, MARK], cancelled: [] });
    // Марк has no Telegram account, so there is nowhere to send and nothing to count.
    expect(notices.map((n) => n.telegramUserId)).toEqual([1001, 1002]);
    expect(notices[0]!.text).toContain("🔒 Обмены смен закрыты.");
  });

  /**
   * One message per person, not one per request. Somebody with two open trades
   * used to be the case that produced three separate messages in one second.
   */
  it("folds every cancelled request of one person into a single message", () => {
    const notices = buildSwapLockNotices({
      locked: true,
      team: [ANYA, IGOR],
      cancelled: [trade(), trade({ requestId: 11, toShift: "Пт 14 авг · 10:00–19:00" })],
    });
    const forAnya = notices.find((n) => n.telegramUserId === 1001)!;
    expect(forAnya.text.match(/отменена/g)).toHaveLength(2);
    expect(notices).toHaveLength(2);
  });

  /**
   * The line names the OTHER side and the shift the reader was giving up: on
   * Anya's phone the useful fact is «this was with Igor», on Igor's it is the
   * reverse. Names stay in the nominative — the database has one display name and
   * nothing that would let us decline it, same rule as the birthday messages.
   */
  it("names the counterparty from the reader's point of view", () => {
    const notices = buildSwapLockNotices({ locked: true, team: [ANYA, IGOR], cancelled: [trade()] });
    const forAnya = notices.find((n) => n.telegramUserId === 1001)!;
    const forIgor = notices.find((n) => n.telegramUserId === 1002)!;
    expect(forAnya.text).toContain("Игорь Петров");
    // Her own shift, not his — the line is written from the reader's side.
    expect(forAnya.text).toContain("Чт 13 авг · 09:00–18:00");
    expect(forIgor.text).toContain("Аня Смирнова");
    expect(forIgor.text).toContain("Чт 13 авг · 12:00–21:00");
  });

  it("says nothing about requests when unlocking", () => {
    const notices = buildSwapLockNotices({ locked: false, team: [ANYA, IGOR], cancelled: [] });
    expect(notices[0]!.text).toBe("🔓 Обмены смен снова открыты.");
  });
});

describe("buildExclusionNotices", () => {
  it("tells the person, and tells each counterparty without naming the cause", () => {
    const notices = buildExclusionNotices({
      excluded: true, person: ANYA, others: [IGOR], cancelled: [trade()],
    });
    const forAnya = notices.find((n) => n.telegramUserId === 1001)!;
    const forIgor = notices.find((n) => n.telegramUserId === 1002)!;
    expect(forAnya.text).toContain("🔒 Тебе закрыли обмены смен.");
    // An admin's decision about one person is not broadcast to the rest.
    expect(forIgor.text).not.toContain("закрыли");
    expect(forIgor.text).toContain("Заявка на обмен — Аня Смирнова");
  });

  it("clearing the flag writes to that person only", () => {
    const notices = buildExclusionNotices({
      excluded: false, person: ANYA, others: [IGOR], cancelled: [],
    });
    expect(notices).toEqual([{ telegramUserId: 1001, text: "🔓 Тебе снова доступны обмены смен." }]);
  });

  /**
   * Guards the asymmetry that the two builders had before `linesFor` existed:
   * the lock builder suppressed cancellation lines when unlocking, this one did
   * not. A stale «cancelled» threaded in by a caller would have made «снова
   * доступны» sprout a list of requests that nothing had just cancelled.
   */
  it("«снова доступны» never grows cancellation lines, even if some are passed in", () => {
    const notices = buildExclusionNotices({
      excluded: false, person: ANYA, others: [], cancelled: [trade()],
    });
    expect(notices).toEqual([{ telegramUserId: 1001, text: "🔓 Тебе снова доступны обмены смен." }]);
  });
});
