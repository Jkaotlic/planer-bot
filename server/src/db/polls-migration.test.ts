import { describe, it, expect } from "vitest";
import { makeTestDb } from "./testdb";
import { createEmployee } from "../repo/employees";
import { polls, pollRecipients, pollVotes } from "./schema";

describe("миграция 0037 — опросы", () => {
  it("опрос, адресат и голос сохраняются; второй голос того же человека — UNIQUE", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const poll = db.insert(polls).values({ createdBy: anya.id, question: "Пицца?" }).returning().get();
    db.insert(pollRecipients).values({ pollId: poll.id, employeeId: anya.id, messageId: 77 }).run();
    db.insert(pollVotes).values({ pollId: poll.id, employeeId: anya.id, choice: "for" }).run();
    expect(() =>
      db.insert(pollVotes).values({ pollId: poll.id, employeeId: anya.id, choice: "against" }).run(),
    ).toThrow(/UNIQUE/i);
    expect(poll.closesAt).toBeNull();
    expect(poll.closedAt).toBeNull();
    expect(poll.cancelledAt).toBeNull();
  });

  it("адресат вносится один раз на опрос", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const poll = db.insert(polls).values({ createdBy: anya.id, question: "?" }).returning().get();
    db.insert(pollRecipients).values({ pollId: poll.id, employeeId: anya.id }).run();
    expect(() => db.insert(pollRecipients).values({ pollId: poll.id, employeeId: anya.id }).run()).toThrow(/UNIQUE|PRIMARY/i);
  });
});
