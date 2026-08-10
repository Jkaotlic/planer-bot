import { describe, it, expect } from "vitest";
import { parseCollectionBody, scheduledSendOnError } from "./collection-body";

describe("parseCollectionBody", () => {
  it("requires a subject when creating and not when editing", () => {
    expect(parseCollectionBody({}, { requireTitle: true })).toEqual({ ok: false, error: expect.stringContaining("Повод") });
    expect(parseCollectionBody({ collectUrl: null }, { requireTitle: false }).ok).toBe(true);
  });

  it("trims the subject and refuses an over-long one", () => {
    const ok = parseCollectionBody({ title: "  Кофемашина  " }, { requireTitle: true });
    expect(ok).toEqual({ ok: true, value: { title: "Кофемашина" } });
    expect(parseCollectionBody({ title: "x".repeat(81) }, { requireTitle: true }).ok).toBe(false);
  });

  it("only lets an http(s) link through — it travels to the whole team", () => {
    expect(parseCollectionBody({ collectUrl: "javascript:alert(1)" }, { requireTitle: false }).ok).toBe(false);
    expect(parseCollectionBody({ collectUrl: "сбер" }, { requireTitle: false }).ok).toBe(false);
    expect(parseCollectionBody({ collectUrl: "https://example.test/c/1" }, { requireTitle: false }).ok).toBe(true);
  });

  it("money is whole roubles inside a sane range", () => {
    expect(parseCollectionBody({ amountPerPerson: 1000 }, { requireTitle: false }).ok).toBe(true);
    expect(parseCollectionBody({ amountPerPerson: 0 }, { requireTitle: false }).ok).toBe(false);
    expect(parseCollectionBody({ amountPerPerson: 10.5 }, { requireTitle: false }).ok).toBe(false);
    expect(parseCollectionBody({ totalGoal: 10_000_001 }, { requireTitle: false }).ok).toBe(false);
    // Explicitly clearing a sum is not the same as a bad sum.
    expect(parseCollectionBody({ totalGoal: null }, { requireTitle: false })).toEqual({ ok: true, value: { totalGoal: null } });
  });

  it("dates must be ISO, and a past one is allowed — it just means «not active»", () => {
    expect(parseCollectionBody({ deadline: "15.08.2026" }, { requireTitle: false }).ok).toBe(false);
    expect(parseCollectionBody({ deadline: "2020-01-01" }, { requireTitle: false }).ok).toBe(true);
  });

  it("keys that were not sent stay absent — an edit touches only what it names", () => {
    const parsed = parseCollectionBody({ collectUrl: "https://example.test/c/1" }, { requireTitle: false });
    expect(parsed.ok && Object.keys(parsed.value)).toEqual(["collectUrl"]);
  });
});

describe("scheduledSendOnError", () => {
  const round = { scheduledSendOn: null as string | null, celebratedOn: "2026-08-05", eventDate: null as string | null, deadline: null as string | null };

  it("does nothing when the field was not sent at all — undefined is not an edit", () => {
    expect(scheduledSendOnError(undefined, round, "2026-08-01")).toBeNull();
  });

  it("accepts a value up to and including the edge date", () => {
    expect(scheduledSendOnError("2026-08-01", round, "2026-08-01")).toBeNull();
    expect(scheduledSendOnError("2026-08-05", round, "2026-08-01")).toBeNull();
  });

  it("refuses a genuinely new date that already lies in the past", () => {
    const result = scheduledSendOnError("2026-07-31", round, "2026-08-01");
    expect(result).not.toBeNull();
    expect(result).toContain("прошла");
  });

  it("refuses a date past the round's own edge (celebratedOn, then deadline, then eventDate)", () => {
    expect(scheduledSendOnError("2026-08-06", round, "2026-08-01")).toContain("поздно");
    const customWithDeadline = { scheduledSendOn: null, celebratedOn: null, eventDate: "2026-09-01", deadline: "2026-08-20" };
    expect(scheduledSendOnError("2026-08-21", customWithDeadline, "2026-08-01")).toContain("поздно");
  });

  it("lets a stale stored value through unchanged — resubmitting it is not an edit", () => {
    const stale = { ...round, scheduledSendOn: "2026-07-25" };
    // "2026-08-03" is after "2026-07-25", so a client resending the round's own
    // stored value must not trip the past-date check just because time moved on.
    expect(scheduledSendOnError("2026-07-25", stale, "2026-08-03")).toBeNull();
  });
});
