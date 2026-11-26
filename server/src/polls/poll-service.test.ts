import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { archiveEmployee, createEmployee, linkTelegramAccount, setEmployeeAdmin } from "../repo/employees";
import { polls } from "../db/schema";
import { eq } from "drizzle-orm";
import { POLL_OPEN_MAX_DAYS, telegramPollConfigSchema } from "@planer/shared";
import type { Db } from "../db/client";
import {
  cancelPoll, castVote, closeDuePolls, closePoll, createPoll, getPoll, listPollsFor, pollView,
  hasTelegramPollFinalState, recordTelegramPollAnswer, recordTelegramPollState, setTelegramPollMessage,
  telegramPollResultText, voteOf,
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

describe("встроенный опрос Telegram", () => {
  function telegramStage(multiple = true) {
    const { db, anya, igor, mark } = stage();
    const poll = createPoll(db, {
      createdBy: anya.id, question: "Что заказать?", closesAt: "2026-09-29T18:00",
      recipientIds: [anya.id, igor.id],
      telegram: { options: ["Салат", "Суп", "Паста"], multiple },
    });
    setTelegramPollMessage(db, poll.id, anya.id, { messageId: 230, telegramPollId: "a", telegramPollChatId: 100 });
    setTelegramPollMessage(db, poll.id, igor.id, { messageId: 231, telegramPollId: "b", telegramPollChatId: 101 });
    return { db, anya, igor, mark, poll };
  }

  it("хранит разные варианты и отклоняет пустое, слишком длинное или совпадающее имя", () => {
    expect(telegramPollConfigSchema.parse({ options: [" Салат ", "Суп"], multiple: false }).options)
      .toEqual(["Салат", "Суп"]);
    for (const options of [["Суп"], ["Суп", " "], ["Суп", " суп "], ["Суп", "х".repeat(101)]]) {
      expect(telegramPollConfigSchema.safeParse({ options, multiple: false }).success).toBe(false);
    }
  });

  it("сводит голоса из двух личных карточек и заменяет выбор при переголосовании", () => {
    const { db, anya, igor, poll } = telegramStage();
    expect(recordTelegramPollAnswer(db, "a", 100, [0, 2], now)).toBe(true);
    expect(recordTelegramPollAnswer(db, "b", 101, [1], now)).toBe(true);
    expect(recordTelegramPollAnswer(db, "b", 101, [2], now)).toBe(true);
    expect(pollView(db, getPoll(db, poll.id)!, igor, now)?.telegram).toEqual({
      options: [{ text: "Салат", count: 1 }, { text: "Суп", count: 0 }, { text: "Паста", count: 2 }],
      multiple: true, myOptionIds: [2], votedCount: 2, canVote: true,
    });
    expect(recordTelegramPollAnswer(db, "a", 100, [], now)).toBe(true);
    expect(pollView(db, poll, anya, now)?.telegram).toMatchObject({ myOptionIds: [], votedCount: 1 });
    expect(castVote(db, poll, anya.id, "for", now)).toMatchObject({ ok: false });
  });

  it("принимает только допустимый голос того, кому пришла эта карточка, до закрытия", () => {
    const { db, anya, igor, mark, poll } = telegramStage(false);
    expect(recordTelegramPollAnswer(db, "a", 101, [0], now)).toBe(false);
    expect(recordTelegramPollAnswer(db, "a", 102, [0], now)).toBe(false);
    expect(recordTelegramPollAnswer(db, "b", 101, [0, 1], now)).toBe(false);
    expect(recordTelegramPollAnswer(db, "b", 101, [3], now)).toBe(false);
    expect(recordTelegramPollAnswer(db, "b", 101, [1], { ...now, time: "18:00" })).toBe(false);
    expect(pollView(db, poll, mark, now)).toBeNull();
    archiveEmployee(db, igor.id, now.date);
    expect(recordTelegramPollAnswer(db, "b", 101, [1], now)).toBe(false);
    closePoll(db, poll, anya);
    expect(recordTelegramPollAnswer(db, "a", 100, [1], now)).toBe(false);
  });

  it("при закрытии по сроку учитывает итог Telegram, даже если опоздал апдейт голоса", () => {
    const { db, anya, poll } = telegramStage();
    expect(closeDuePolls(db, { ...now, time: "18:00" }).map(({ id }) => id)).toEqual([poll.id]);
    const snapshot = {
      id: "a", is_closed: true, total_voter_count: 1,
      options: [{ text: "Салат", voter_count: 0 }, { text: "Суп", voter_count: 1 }, { text: "Паста", voter_count: 1 }],
    };
    expect(telegramPollResultText(db, getPoll(db, poll.id)!)).toContain("Предварительный итог");
    expect(recordTelegramPollState(db, { ...snapshot, total_voter_count: 2 })).toBe(false);
    expect(recordTelegramPollState(db, { ...snapshot, is_closed: false })).toBe(false);
    expect(recordTelegramPollState(db, { ...snapshot, options: [...snapshot.options].reverse() })).toBe(false);
    expect(recordTelegramPollState(db, snapshot)).toBe(true);
    expect(hasTelegramPollFinalState(db, 100, 230)).toBe(true);
    expect(hasTelegramPollFinalState(db, 101, 231)).toBe(false);
    expect(pollView(db, getPoll(db, poll.id)!, anya, now)?.telegram).toMatchObject({
      votedCount: 1, myOptionIds: [1, 2], canVote: false,
    });
    expect(recordTelegramPollState(db, {
      ...snapshot, total_voter_count: 0, options: snapshot.options.map((option) => ({ ...option, voter_count: 0 })),
    })).toBe(true);
    expect(pollView(db, poll, anya, now)?.telegram?.votedCount).toBe(0);
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

  it("опрос без срока закрывается тиком через POLL_OPEN_MAX_DAYS — и у архивного создателя тоже", () => {
    const { db, anya, igor, poll } = stage();
    const at = new Date("2026-09-29T09:00:00Z");
    const minutesAgo = (m: number) => new Date(at.getTime() - m * 60_000);
    const day = 24 * 60;
    expect(POLL_OPEN_MAX_DAYS).toBe(3);
    // Аня — 3 дня и минуту назад; ровно 3 дня — тоже срок; 2 дня 23 часа — ещё нет.
    db.update(polls).set({ createdAt: minutesAgo(3 * day + 1) }).where(eq(polls.id, poll.id)).run();
    const exact = createPoll(db, { createdBy: anya.id, question: "Ровно три дня", closesAt: null, recipientIds: [anya.id] });
    db.update(polls).set({ createdAt: minutesAgo(3 * day) }).where(eq(polls.id, exact.id)).run();
    const young = createPoll(db, { createdBy: anya.id, question: "Свежий", closesAt: null, recipientIds: [anya.id] });
    db.update(polls).set({ createdAt: minutesAgo(2 * day + 23 * 60) }).where(eq(polls.id, young.id)).run();
    // Создатель ушёл из команды — закрыть руками опрос больше некому, кроме тика.
    const orphan = createPoll(db, { createdBy: igor.id, question: "Сирота", closesAt: null, recipientIds: [anya.id, igor.id] });
    db.update(polls).set({ createdAt: minutesAgo(3 * day + 1) }).where(eq(polls.id, orphan.id)).run();
    // Со сроком — живёт до срока, сколько бы дней ни прошло с создания.
    const later = createPoll(db, { createdBy: anya.id, question: "Со сроком", closesAt: "2026-09-29T18:00", recipientIds: [anya.id] });
    db.update(polls).set({ createdAt: minutesAgo(4 * day) }).where(eq(polls.id, later.id)).run();
    archiveEmployee(db, igor.id, now.date);

    expect(closeDuePolls(db, now, at).map((p) => p.question).sort()).toEqual(["Пицца в пятницу?", "Ровно три дня", "Сирота"].sort());
    expect(getPoll(db, young.id)!.closedAt).toBeNull();
    expect(getPoll(db, later.id)!.closedAt).toBeNull();
    expect(closeDuePolls(db, now, at)).toEqual([]);
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

  it("админ видит в списке чужие идущие опросы — закрыть он вправе, значит, должен их видеть", () => {
    const { db, anya, mark } = stage();
    const done = createPoll(db, { createdBy: anya.id, question: "Уже закрыт", closesAt: null, recipientIds: [anya.id] });
    closePoll(db, done, anya);
    const dropped = createPoll(db, { createdBy: anya.id, question: "Отменён", closesAt: null, recipientIds: [anya.id] });
    cancelPoll(db, dropped, anya);
    expect(listPollsFor(db, { id: mark.id, isAdmin: true }, now).map((p) => p.question)).toEqual(["Пицца в пятницу?"]);
    expect(listPollsFor(db, mark, now)).toEqual([]);
  });

  it("чужие идущие опросы не вытесняют у не-админа его собственные из двадцатки", () => {
    const { db, anya, mark } = stage();
    for (let i = 0; i < 20; i += 1) createPoll(db, { createdBy: mark.id, question: `Чужой ${i}`, closesAt: null, recipientIds: [mark.id] });
    expect(listPollsFor(db, anya, now).map((p) => p.question)).toEqual(["Пицца в пятницу?"]);
  });
});
