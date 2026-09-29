import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setEmployeeAdmin } from "../repo/employees";
import type { Db } from "../db/client";
import {
  cancelPoll, castVote, closeDuePolls, closePoll, createPoll, getPoll, listPollsFor, pollView, voteOf,
} from "./poll-service";

const now = { date: "2026-09-29", time: "12:00" };

function person(db: Db, name: string, tg: number): { id: number; isAdmin: boolean } {
  const e = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  linkTelegramAccount(db, `inv-${name}`, tg);
  return { id: e.id, isAdmin: false };
}

function stage(closesAt: string | null = null) {
  const db = makeTestDb();
  const anya = person(db, "Аня", 100);
  const igor = person(db, "Игорь", 101);
  const mark = person(db, "Марк", 102);
  const poll = createPoll(db, { createdBy: anya.id, question: "Пицца в пятницу?", closesAt, recipientIds: [anya.id, igor.id] });
  return { db, anya, igor, mark, poll };
}

describe("голосование", () => {
  it("адресат голосует и переголосовывает — голос один", () => {
    const { db, igor, poll } = stage();
    expect(castVote(db, poll, igor.id, "for", now)).toEqual({ ok: true });
    expect(castVote(db, poll, igor.id, "against", now)).toEqual({ ok: true });
    expect(voteOf(db, poll.id, igor.id)).toBe("against");
  });

  it("не адресат голосовать не может — даже пересланной кнопкой", () => {
    const { db, mark, poll } = stage();
    expect(castVote(db, poll, mark.id, "for", now)).toEqual({ ok: false, error: "Этот опрос тебе не приходил." });
    expect(voteOf(db, poll.id, mark.id)).toBeNull();
  });

  it("после срока голос не принимается, даже если тик ещё не прошёл", () => {
    const { db, igor, poll } = stage("2026-09-29T11:59");
    expect(castVote(db, poll, igor.id, "for", now)).toEqual({ ok: false, error: "Опрос закрыт." });
  });

  it("после закрытия руками голос не принимается", () => {
    const { db, anya, igor, poll } = stage();
    closePoll(db, poll, anya);
    expect(castVote(db, getPoll(db, poll.id)!, igor.id, "for", now)).toEqual({ ok: false, error: "Опрос закрыт." });
  });
});

describe("закрытие и отмена", () => {
  it("закрыть может запускающий и админ, но не участник", () => {
    const { db, igor, poll } = stage();
    expect(closePoll(db, poll, igor)).toEqual({ ok: false, error: "Закрыть может только тот, кто запустил опрос." });
    setEmployeeAdmin(db, igor.id, true);
    expect(closePoll(db, poll, { id: igor.id, isAdmin: true })).toEqual({ ok: true });
  });

  it("второе закрытие — отказ: итог не должен уйти дважды", () => {
    const { db, anya, poll } = stage();
    expect(closePoll(db, poll, anya)).toEqual({ ok: true });
    expect(closePoll(db, getPoll(db, poll.id)!, anya)).toEqual({ ok: false, error: "Опрос уже закрыт." });
  });

  it("отменённый не закрывается и не голосуется", () => {
    const { db, anya, igor, poll } = stage();
    expect(cancelPoll(db, poll, anya)).toEqual({ ok: true });
    const fresh = getPoll(db, poll.id)!;
    expect(closePoll(db, fresh, anya).ok).toBe(false);
    expect(castVote(db, fresh, igor.id, "for", now).ok).toBe(false);
  });

  it("closeDuePolls закрывает только просроченные и только один раз", () => {
    const { db, anya } = stage("2026-09-29T11:00");
    createPoll(db, { createdBy: anya.id, question: "Позже", closesAt: "2026-09-29T18:00", recipientIds: [anya.id] });
    createPoll(db, { createdBy: anya.id, question: "Без срока", closesAt: null, recipientIds: [anya.id] });
    expect(closeDuePolls(db, now).map((p) => p.question)).toEqual(["Пицца в пятницу?"]);
    expect(closeDuePolls(db, now)).toEqual([]);
  });

  it("ручное закрытие после тика — отказ, то есть рассылки не будет", () => {
    const { db, anya, poll } = stage("2026-09-29T11:00");
    closeDuePolls(db, now);
    expect(closePoll(db, getPoll(db, poll.id)!, anya).ok).toBe(false);
  });
});

describe("вид опроса", () => {
  it("адресат видит итог с именами и свой голос", () => {
    const { db, anya, igor, poll } = stage();
    castVote(db, poll, igor.id, "for", now);
    const view = pollView(db, poll, igor, now)!;
    expect(view.myChoice).toBe("for");
    expect(view.tally).toEqual({ for: ["Игорь"], against: [], abstain: [], silent: ["Аня"] });
    expect(view.isCreator).toBe(false);
    expect(view.canManage).toBe(false);
    expect(pollView(db, poll, anya, now)!.canManage).toBe(true);
  });

  it("посторонний не видит опрос вовсе, админ — видит", () => {
    const { db, mark, poll } = stage();
    expect(pollView(db, poll, mark, now)).toBeNull();
    expect(pollView(db, poll, { id: mark.id, isAdmin: true }, now)).not.toBeNull();
  });

  it("список — только свои опросы, новые сверху", () => {
    const { db, anya, igor, mark } = stage();
    createPoll(db, { createdBy: mark.id, question: "Чужой", closesAt: null, recipientIds: [mark.id] });
    createPoll(db, { createdBy: igor.id, question: "Второй", closesAt: null, recipientIds: [igor.id, anya.id] });
    expect(listPollsFor(db, anya, now).map((p) => p.question)).toEqual(["Второй", "Пицца в пятницу?"]);
  });
});
