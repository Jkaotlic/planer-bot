import { and, desc, eq, inArray, isNull, lte, isNotNull, or } from "drizzle-orm";
import { closesLabel, isOpenAt, pollTally, type PollChoice, type PollTally } from "@planer/shared";
import type { Db } from "../db/client";
import { employees, pollRecipients, pollVotes, polls, type Poll } from "../db/schema";

export type Result = { ok: true } | { ok: false; error: string };
export type TeamClock = { date: string; time: string };
type Viewer = { id: number; isAdmin: boolean };

/**
 * Управлять опросом или заказом может тот, кто его запустил, — и админ.
 *
 * Админ — страховка, а не власть: запускающий ушёл домой, заказ висит
 * открытым, и кто-то должен уметь его закрыть. Одна функция на оба модуля,
 * чтобы правило не разъехалось между опросами и едой.
 */
export function canManage(owner: { createdBy: number }, viewer: Viewer): boolean {
  return owner.createdBy === viewer.id || viewer.isAdmin;
}

export function createPoll(
  db: Db,
  input: { createdBy: number; question: string; closesAt: string | null; recipientIds: number[] },
): Poll {
  return db.transaction((tx) => {
    const poll = tx.insert(polls).values({ createdBy: input.createdBy, question: input.question, closesAt: input.closesAt }).returning().get();
    for (const employeeId of input.recipientIds) {
      tx.insert(pollRecipients).values({ pollId: poll.id, employeeId }).onConflictDoNothing().run();
    }
    return poll;
  });
}

export function setPollMessageId(db: Db, pollId: number, employeeId: number, messageId: number | null): void {
  db.update(pollRecipients).set({ messageId })
    .where(and(eq(pollRecipients.pollId, pollId), eq(pollRecipients.employeeId, employeeId))).run();
}

export function getPoll(db: Db, id: number): Poll | undefined {
  return db.select().from(polls).where(eq(polls.id, id)).get();
}

export function pollRecipientRows(db: Db, pollId: number) {
  return db
    .select({
      employeeId: pollRecipients.employeeId,
      displayName: employees.displayName,
      telegramUserId: employees.telegramUserId,
      messageId: pollRecipients.messageId,
    })
    .from(pollRecipients)
    .innerJoin(employees, eq(employees.id, pollRecipients.employeeId))
    .where(eq(pollRecipients.pollId, pollId))
    .orderBy(pollRecipients.employeeId)
    .all();
}

export function isPollRecipient(db: Db, pollId: number, employeeId: number): boolean {
  return db.select({ id: pollRecipients.employeeId }).from(pollRecipients)
    .where(and(eq(pollRecipients.pollId, pollId), eq(pollRecipients.employeeId, employeeId))).get() != null;
}

export function voteOf(db: Db, pollId: number, employeeId: number): PollChoice | null {
  return db.select({ choice: pollVotes.choice }).from(pollVotes)
    .where(and(eq(pollVotes.pollId, pollId), eq(pollVotes.employeeId, employeeId))).get()?.choice ?? null;
}

/**
 * Голос. Порядок проверок тот же, что в боте и в HTTP: сначала «закрыт»,
 * потом «не тебе» — закрытый опрос отвечает одинаково всем, и посторонний не
 * узнаёт из ответа, был ли он в списке.
 */
export function castVote(db: Db, poll: Poll, employeeId: number, choice: PollChoice, now: TeamClock): Result {
  if (!isOpenAt(poll, now)) return { ok: false, error: "Опрос закрыт." };
  if (!isPollRecipient(db, poll.id, employeeId)) return { ok: false, error: "Этот опрос тебе не приходил." };
  db.insert(pollVotes).values({ pollId: poll.id, employeeId, choice })
    .onConflictDoUpdate({ target: [pollVotes.pollId, pollVotes.employeeId], set: { choice, votedAt: new Date() } })
    .run();
  return { ok: true };
}

/**
 * Закрытие — условный UPDATE, а не «прочитал, проверил, записал».
 *
 * Тик и кнопка «Закрыть» могут прийти в одну секунду; побеждает тот, чей
 * UPDATE изменил строку, и только он рассылает итог. Иначе люди получили бы
 * итог дважды.
 */
function finish(db: Db, pollId: number, column: "closedAt" | "cancelledAt"): boolean {
  const changed = db.update(polls).set({ [column]: new Date() })
    .where(and(eq(polls.id, pollId), isNull(polls.closedAt), isNull(polls.cancelledAt)))
    .run();
  return changed.changes > 0;
}

export function closePoll(db: Db, poll: Poll, viewer: Viewer): Result {
  if (!canManage(poll, viewer)) return { ok: false, error: "Закрыть может только тот, кто запустил опрос." };
  if (poll.cancelledAt != null) return { ok: false, error: "Опрос отменён." };
  return finish(db, poll.id, "closedAt") ? { ok: true } : { ok: false, error: "Опрос уже закрыт." };
}

export function cancelPoll(db: Db, poll: Poll, viewer: Viewer): Result {
  if (!canManage(poll, viewer)) return { ok: false, error: "Отменить может только тот, кто запустил опрос." };
  return finish(db, poll.id, "cancelledAt") ? { ok: true } : { ok: false, error: "Опрос уже закрыт." };
}

export function closeDuePolls(db: Db, now: TeamClock): Poll[] {
  const due = db.select().from(polls)
    .where(and(isNull(polls.closedAt), isNull(polls.cancelledAt), isNotNull(polls.closesAt), lte(polls.closesAt, `${now.date}T${now.time}`)))
    .all();
  return due.filter((p) => finish(db, p.id, "closedAt"));
}

export interface PollView {
  id: number;
  question: string;
  creatorId: number;
  creatorName: string;
  closesAt: string | null;
  closes: string | null;
  open: boolean;
  cancelled: boolean;
  isCreator: boolean;
  canManage: boolean;
  myChoice: PollChoice | null;
  tally: PollTally;
  recipientCount: number;
}

/**
 * Опрос глазами смотрящего. Итог с именами видят все адресаты — он просил
 * «учёт, кто за или против», и тайного голосования в команде не заводили.
 */
export function pollView(db: Db, poll: Poll, viewer: Viewer, now: TeamClock): PollView | null {
  const recipients = pollRecipientRows(db, poll.id);
  const manage = canManage(poll, viewer);
  if (!manage && !recipients.some((r) => r.employeeId === viewer.id)) return null;
  const votes = db.select({ employeeId: pollVotes.employeeId, choice: pollVotes.choice })
    .from(pollVotes).where(eq(pollVotes.pollId, poll.id)).all();
  const creatorName = db.select({ name: employees.displayName }).from(employees)
    .where(eq(employees.id, poll.createdBy)).get()?.name ?? "—";
  return {
    id: poll.id,
    question: poll.question,
    creatorId: poll.createdBy,
    creatorName,
    closesAt: poll.closesAt,
    closes: closesLabel(poll.closesAt, now.date),
    open: isOpenAt(poll, now),
    cancelled: poll.cancelledAt != null,
    isCreator: poll.createdBy === viewer.id,
    canManage: manage,
    myChoice: votes.find((v) => v.employeeId === viewer.id)?.choice ?? null,
    tally: pollTally(recipients, votes),
    recipientCount: recipients.length,
  };
}

/** Последние двадцать — старше экрану не нужно: опрос живёт день-два. */
export function listPollsFor(db: Db, viewer: Viewer, now: TeamClock): PollView[] {
  const mine = db.select({ pollId: pollRecipients.pollId }).from(pollRecipients)
    .where(eq(pollRecipients.employeeId, viewer.id)).all().map((r) => r.pollId);
  const rows = db.select().from(polls)
    .where(or(eq(polls.createdBy, viewer.id), mine.length > 0 ? inArray(polls.id, mine) : undefined))
    .orderBy(desc(polls.id)).limit(20).all();
  return rows.map((p) => pollView(db, p, viewer, now)).filter((v): v is PollView => v != null);
}
