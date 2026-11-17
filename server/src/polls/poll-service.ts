import { and, desc, eq, gte, inArray, isNull, lte, isNotNull, or, sql } from "drizzle-orm";
import {
  POLL_OPEN_MAX_DAYS, closesLabel, isOpenAt, pollTally,
  type PollChoice, type PollView, type TelegramPollConfig, type TelegramPollView,
} from "@planer/shared";
import type { Db } from "../db/client";
import { employees, pollRecipients, pollVotes, polls, type Poll } from "../db/schema";

export type Result = { ok: true } | { ok: false; error: string };
export type TeamClock = { date: string; time: string };
type Viewer = { id: number; isAdmin: boolean };

const telegramPollsSending = new WeakMap<Db, Set<number>>();

export function beginTelegramPollSending(db: Db, pollId: number): (() => void) | null {
  const sending = telegramPollsSending.get(db) ?? new Set<number>();
  if (sending.has(pollId)) return null;
  sending.add(pollId);
  telegramPollsSending.set(db, sending);
  return () => { sending.delete(pollId); };
}

export function isTelegramPollSending(db: Db, pollId: number): boolean {
  return telegramPollsSending.get(db)?.has(pollId) ?? false;
}

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
  input: { createdBy: number; question: string; closesAt: string | null; recipientIds: number[]; telegram?: TelegramPollConfig },
): Poll {
  return db.transaction((tx) => {
    const poll = tx.insert(polls).values({
      createdBy: input.createdBy,
      question: input.question,
      closesAt: input.closesAt,
      telegramOptions: input.telegram?.options,
      telegramMultiple: input.telegram?.multiple,
    }).returning().get();
    for (const employeeId of input.recipientIds) {
      tx.insert(pollRecipients).values({ pollId: poll.id, employeeId }).onConflictDoNothing().run();
    }
    return poll;
  });
}

/**
 * Окно, в котором такой же опрос (или заказ из того же места) от того же
 * человека — повтор, а не новый. Две минуты перекрывают обрыв релея и повторный
 * тап; дольше — уже осознанное «спрошу ещё раз».
 */
export const FOOD_REPEAT_WINDOW_SEC = 120;

/** Вопрос для сравнения «тот же ли»: регистр и лишние пробелы вопроса не меняют. */
export function normalizeQuestion(question: string): string {
  return question.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}

/**
 * Был ли такой опрос от того же человека за последние `FOOD_REPEAT_WINDOW_SEC`.
 *
 * Время — `unixepoch()` самой базы, а не `Date.now()`: `created_at` пишет
 * SQLite, и сравнивать его надо с теми же часами. Отменённый не считается:
 * его отменили нарочно, и новый — не повтор. Регистр сравнивается в JS:
 * `lower()` SQLite кириллицу не понижает.
 */
export function hasRecentSamePoll(db: Db, createdBy: number, question: string): boolean {
  const target = normalizeQuestion(question);
  return db.select({ question: polls.question }).from(polls).where(and(
    eq(polls.createdBy, createdBy), isNull(polls.cancelledAt),
    gte(polls.createdAt, sql`unixepoch() - ${FOOD_REPEAT_WINDOW_SEC}`),
  )).all().some((p) => normalizeQuestion(p.question) === target);
}

export function setPollMessageId(db: Db, pollId: number, employeeId: number, messageId: number | null): void {
  db.update(pollRecipients).set({ messageId })
    .where(and(eq(pollRecipients.pollId, pollId), eq(pollRecipients.employeeId, employeeId))).run();
}

export function setTelegramPollMessage(
  db: Db,
  pollId: number,
  employeeId: number,
  message: { messageId: number; telegramPollId: string; telegramPollChatId: number },
): void {
  db.update(pollRecipients).set(message)
    .where(and(eq(pollRecipients.pollId, pollId), eq(pollRecipients.employeeId, employeeId))).run();
}

/** Telegram присылает текущее состояние выбора целиком, в том числе пустое при отзыве. */
export function recordTelegramPollAnswer(
  db: Db, telegramPollId: string, telegramUserId: number, optionIds: readonly number[], now: TeamClock,
): boolean {
  const ballot = telegramBallot(db, telegramPollId);
  if (!ballot?.poll.telegramOptions || ballot.finalized || ballot.chatId !== telegramUserId || !isOpenAt(ballot.poll, now)) return false;
  const options = ballot.poll.telegramOptions;
  const choices = [...new Set(optionIds)].sort((a, b) => a - b);
  if ((!ballot.poll.telegramMultiple && choices.length > 1)
      || choices.some((id) => !Number.isInteger(id) || id < 0 || id >= options.length)) return false;
  saveTelegramChoices(db, telegramPollId, choices, false);
  return true;
}

function telegramBallot(db: Db, telegramPollId: string) {
  return db.select({ poll: polls, chatId: pollRecipients.telegramPollChatId, finalized: pollRecipients.telegramFinalized })
    .from(pollRecipients)
    .innerJoin(polls, eq(pollRecipients.pollId, polls.id))
    .innerJoin(employees, eq(pollRecipients.employeeId, employees.id))
    .where(and(
      eq(pollRecipients.telegramPollId, telegramPollId),
      eq(pollRecipients.telegramPollChatId, employees.telegramUserId),
      eq(employees.isActive, true),
    )).get();
}

function saveTelegramChoices(db: Db, telegramPollId: string, choices: number[], finalized: boolean): void {
  db.update(pollRecipients).set({ telegramChoices: choices, telegramFinalized: finalized })
    .where(eq(pollRecipients.telegramPollId, telegramPollId)).run();
}

/** У PollAnswer нет времени голоса. При закрытии берём окончательное состояние личной карточки. */
export function recordTelegramPollState(db: Db, snapshot: {
  id: string;
  is_closed: boolean;
  total_voter_count: number;
  options: readonly { text: string; voter_count: number }[];
}): boolean {
  if (!snapshot.is_closed || (snapshot.total_voter_count !== 0 && snapshot.total_voter_count !== 1)) return false;
  const ballot = telegramBallot(db, snapshot.id);
  const options = ballot?.poll.telegramOptions;
  if (!options || ballot.poll.cancelledAt != null || options.length !== snapshot.options.length) return false;
  if (snapshot.options.some(({ text, voter_count }, index) => text !== options[index] || (voter_count !== 0 && voter_count !== 1))) return false;
  const choices = snapshot.options.flatMap(({ voter_count }, index) => voter_count === 1 ? [index] : []);
  if (Number(choices.length > 0) !== snapshot.total_voter_count || (!ballot.poll.telegramMultiple && choices.length > 1)) return false;
  saveTelegramChoices(db, snapshot.id, choices, true);
  return true;
}

export function hasTelegramPollFinalState(db: Db, chatId: number, messageId: number): boolean {
  return db.select({ finalized: pollRecipients.telegramFinalized }).from(pollRecipients)
    .where(and(eq(pollRecipients.telegramPollChatId, chatId), eq(pollRecipients.messageId, messageId)))
    .get()?.finalized === true;
}

export function getPoll(db: Db, id: number): Poll | undefined {
  return db.select().from(polls).where(eq(polls.id, id)).get();
}

/**
 * Адресаты опроса, которые ещё в команде.
 *
 * Архивация строки `poll_recipients` не трогает, а опрос без срока живёт
 * дольше, чем человек в команде. Без фильтра ушедший получал бы итог и
 * «Опрос отменён» и стоял бы в «Не ответили», хотя отвечать ему уже не на
 * что. Строка не удаляется: вернули из архива — он снова адресат.
 */
export function pollRecipientRows(db: Db, pollId: number) {
  return db
    .select({
      employeeId: pollRecipients.employeeId,
      displayName: employees.displayName,
      telegramUserId: employees.telegramUserId,
      messageId: pollRecipients.messageId,
      telegramPollId: pollRecipients.telegramPollId,
      telegramPollChatId: pollRecipients.telegramPollChatId,
      telegramChoices: pollRecipients.telegramChoices,
      telegramFinalized: pollRecipients.telegramFinalized,
    })
    .from(pollRecipients)
    .innerJoin(employees, eq(employees.id, pollRecipients.employeeId))
    .where(and(eq(pollRecipients.pollId, pollId), eq(employees.isActive, true)))
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
  if (poll.telegramOptions) return { ok: false, error: "Проголосуй в опросе в чате с ботом." };
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

/**
 * Опросы, которым пора закрыться: срок прошёл или опрос без срока старше
 * `POLL_OPEN_MAX_DAYS`.
 *
 * Возраст считается от момента `at` (по умолчанию — сейчас), а не от
 * командной даты: `createdAt` — момент UTC, и «три дня» здесь — длительность,
 * а не граница дня, так что часовой пояс команды ни на что не влияет.
 */
export function closeDuePolls(db: Db, now: TeamClock, at: Date = new Date()): Poll[] {
  const tooOld = new Date(at.getTime() - POLL_OPEN_MAX_DAYS * 24 * 60 * 60 * 1000);
  const due = db.select().from(polls)
    .where(and(isNull(polls.closedAt), isNull(polls.cancelledAt), or(
      and(isNotNull(polls.closesAt), lte(polls.closesAt, `${now.date}T${now.time}`)),
      and(isNull(polls.closesAt), lte(polls.createdAt, tooOld)),
    )))
    .all();
  return due.filter((p) => finish(db, p.id, "closedAt"));
}

export type { PollView } from "@planer/shared";

type PollRecipientRow = ReturnType<typeof pollRecipientRows>[number];

function hasCurrentTelegramBallot(row: PollRecipientRow): boolean {
  return row.telegramPollId != null && row.telegramPollChatId === row.telegramUserId;
}

function hasTelegramVote(row: PollRecipientRow): boolean {
  return hasCurrentTelegramBallot(row) && (row.telegramChoices?.length ?? 0) > 0;
}

function summarizeTelegramPoll(poll: Poll, recipients: readonly PollRecipientRow[], viewerId?: number): TelegramPollView {
  const options = (poll.telegramOptions ?? []).map((text) => ({ text, count: 0 }));
  const submitted = recipients.filter(hasTelegramVote);
  for (const row of submitted) {
    for (const choice of row.telegramChoices ?? []) {
      const option = options[choice];
      if (option) option.count += 1;
    }
  }
  const mine = recipients.find((row) => row.employeeId === viewerId && hasCurrentTelegramBallot(row));
  return {
    options, multiple: poll.telegramMultiple, myOptionIds: mine?.telegramChoices ?? [],
    votedCount: submitted.length, canVote: mine != null,
  };
}

export function telegramPollSummary(db: Db, poll: Poll, viewerId?: number): TelegramPollView {
  return summarizeTelegramPoll(poll, pollRecipientRows(db, poll.id), viewerId);
}

export function telegramPollResultText(db: Db, poll: Poll): string {
  const recipients = pollRecipientRows(db, poll.id);
  const { options, votedCount } = summarizeTelegramPoll(poll, recipients);
  const waiting = poll.closedAt && recipients.some((row) => hasCurrentTelegramBallot(row) && !row.telegramFinalized);
  return [
    `📊 ${waiting ? "Предварительный итог" : "Итоги опроса"}: ${poll.question}`,
    "",
    ...options.map(({ text, count }) => `• ${text} — ${count}`),
    "",
    `Ответили: ${votedCount}`,
    ...(waiting ? ["", "Telegram ещё не подтвердил часть голосов. Общий итог можно обновить в приложении."] : []),
  ].join("\n");
}

/**
 * Опрос глазами смотрящего. Итог с именами видят все адресаты — он просил
 * «учёт, кто за или против», и тайного голосования в команде не заводили.
 */
export function pollView(db: Db, poll: Poll, viewer: Viewer, now: TeamClock): PollView | null {
  const recipients = pollRecipientRows(db, poll.id);
  const manage = canManage(poll, viewer);
  if (!manage && !recipients.some((r) => r.employeeId === viewer.id)) return null;
  const telegram = poll.telegramOptions ? summarizeTelegramPoll(poll, recipients, viewer.id) : null;
  const votes = telegram ? [] : db.select({ employeeId: pollVotes.employeeId, choice: pollVotes.choice })
    .from(pollVotes).where(eq(pollVotes.pollId, poll.id)).all();
  const creatorName = db.select({ name: employees.displayName }).from(employees)
    .where(eq(employees.id, poll.createdBy)).get()?.name ?? "—";
  const open = isOpenAt(poll, now);
  return {
    id: poll.id,
    question: poll.question,
    creatorId: poll.createdBy,
    creatorName,
    closesAt: poll.closesAt,
    closes: closesLabel(poll.closesAt, now.date),
    open,
    cancelled: poll.cancelledAt != null,
    isCreator: poll.createdBy === viewer.id,
    canManage: manage,
    myChoice: votes.find((v) => v.employeeId === viewer.id)?.choice ?? null,
    tally: pollTally(telegram ? recipients.filter((row) => !hasTelegramVote(row)) : recipients, votes),
    recipientCount: recipients.length,
    ...(telegram ? { telegram: { ...telegram, canVote: open && telegram.canVote } } : {}),
  };
}

/**
 * Последние двадцать — старше экрану не нужно: опрос живёт день-два.
 *
 * Админу — ещё и все чужие идущие: закрыть чужой опрос он вправе
 * (`canManage`), а право без кнопки на экране ничего не стоит. Закрытые чужие
 * не показываются — это экран текущих дел, а не архив команды.
 */
export function listPollsFor(db: Db, viewer: Viewer, now: TeamClock): PollView[] {
  const mine = db.select({ pollId: pollRecipients.pollId }).from(pollRecipients)
    .where(eq(pollRecipients.employeeId, viewer.id)).all().map((r) => r.pollId);
  const rows = db.select().from(polls)
    .where(or(
      eq(polls.createdBy, viewer.id),
      mine.length > 0 ? inArray(polls.id, mine) : undefined,
      viewer.isAdmin ? and(isNull(polls.closedAt), isNull(polls.cancelledAt)) : undefined,
    ))
    .orderBy(desc(polls.id)).limit(20).all();
  return rows.map((p) => pollView(db, p, viewer, now)).filter((v): v is PollView => v != null);
}
