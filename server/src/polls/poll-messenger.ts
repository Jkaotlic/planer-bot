import { InlineKeyboard, type Bot } from "grammy";
import {
  POLL_CHOICE_LABEL, POLL_CHOICES, POLL_OPEN_MAX_DAYS, closesLetterLabel, isOpenAt, pollInviteText,
  pollResultText, pollTally, shiftStartMs, type PollChoice,
} from "@planer/shared";
import type { Db } from "../db/client";
import { employees, pollRecipients, pollVotes, type Poll } from "../db/schema";
import { eq } from "drizzle-orm";
import { sendTracked } from "../bot/tracked-send";
import { notifyUser } from "../bot/notify";
import { safeErrorMessage } from "../util/safe-error";
import { getEmployeeById } from "../repo/employees";
import {
  beginTelegramPollSending, getPoll, pollRecipientRows, setPollMessageId, setTelegramPollMessage, voteOf, type TeamClock,
} from "./poll-service";
import { deliverFoodCloseMessages, queueFoodCloseMessages, type FoodCloseMessage, type FoodCloseReason } from "../food/food-close-delivery";

/**
 * Кнопки под опросом. Одна функция на рассылку и на правку после тапа, чтобы
 * строки колбэков `poll:v:<id>:<choice>` не разъехались между ними.
 *
 * Выбранный ответ помечается «✓» — так человек видит свой голос, не читая
 * текст письма.
 */
export function pollKeyboard(pollId: number, myChoice: PollChoice | null, manage: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const choice of POLL_CHOICES) {
    const label = POLL_CHOICE_LABEL[choice];
    kb.text(choice === myChoice ? `✓ ${label}` : label, `poll:v:${pollId}:${choice}`);
  }
  kb.row().text("📊 Итоги", `poll:r:${pollId}`);
  if (manage) kb.row().text("🔒 Закрыть опрос", `poll:close:${pollId}`);
  return kb;
}

function telegramPollFinishMessage(poll: Poll, reason: FoodCloseReason) {
  return reason === "closed"
    ? { nativePollSummary: true as const }
    : { body: `🚫 Опрос отменён: ${poll.question}` };
}

function creatorName(db: Db, poll: Poll): string {
  return db.select({ name: employees.displayName }).from(employees).where(eq(employees.id, poll.createdBy)).get()?.name ?? "Коллега";
}

/**
 * Текст письма опроса для конкретного человека — и при рассылке, и после его тапа.
 * Срок — `closesLetterLabel`, а не экранный `closesLabel`: письмо читают позже,
 * и «до завтра» из него к утру соврало бы.
 */
export function pollTextFor(db: Db, poll: Poll, employeeId: number, today: string): string {
  return pollInviteText({
    creatorName: creatorName(db, poll),
    question: poll.question,
    closes: closesLetterLabel(poll.closesAt, today),
    myChoice: voteOf(db, poll.id, employeeId),
  });
}

/**
 * Перерисовать письмо опроса одного человека — после его голоса в мини-аппе,
 * чтобы «Твой голос» и «✓» на кнопке не врали до следующего тапа в чате.
 * Косметика, как `redrawOrderMessage`: ошибки — в лог, закрытый опрос не
 * трогаем: снятие кнопок уже поставлено в очередь.
 */
export async function redrawPollMessage(bot: Bot, db: Db, poll: Poll, employeeId: number, now: TeamClock): Promise<void> {
  try {
    if (poll.telegramOptions || !isOpenAt(poll, now)) return;
    const row = pollRecipientRows(db, poll.id).find((r) => r.employeeId === employeeId);
    if (row?.telegramUserId == null || row.messageId == null) return;
    await bot.api.editMessageText(row.telegramUserId, row.messageId, pollTextFor(db, poll, employeeId, now.date), {
      reply_markup: pollKeyboard(poll.id, voteOf(db, poll.id, employeeId), employeeId === poll.createdBy),
    });
  } catch (err) {
    console.error("poll: cosmetic redraw failed:", safeErrorMessage(err));
  }
}

/**
 * «Напомнить молчащим» — зеркало `remindUnpaid` у заказа: только по кнопке
 * запускающего или админа, только тем, кто ещё в команде и не ответил.
 * Архивных `pollRecipientRows` уже не отдаёт — напоминать ушедшему не о чем.
 *
 * Письмо — то же приглашение с кнопками голоса: ответить человек должен прямо
 * из напоминания, а не искать исходное письмо выше в чате. Отметка голоса
 * перерисует именно напоминание (тапнутое письмо), исходное — при голосе из
 * мини-аппа, как и раньше.
 *
 * `silent` — сколько молчало на момент вызова (знаменатель «D из N»);
 * `unreachable` — кого не достучаться, поимённо: без Telegram или бот
 * заблокирован. Нулевой `delivered` при непустом `unreachable` — не то же, что
 * «все ответили», и вызывающий должен уметь их различить.
 */
export async function remindSilent(
  bot: Bot, db: Db, poll: Poll, now: TeamClock,
): Promise<{ delivered: number; silent: number; unreachable: string[] }> {
  if (poll.telegramOptions) return remindTelegramPoll(bot, db, poll);
  const voted = new Set(db.select({ employeeId: pollVotes.employeeId })
    .from(pollVotes).where(eq(pollVotes.pollId, poll.id)).all().map((v) => v.employeeId));
  const silent = pollRecipientRows(db, poll.id).filter((r) => !voted.has(r.employeeId));
  let delivered = 0;
  const unreachable: string[] = [];
  for (const r of silent) {
    if (r.telegramUserId == null) { unreachable.push(r.displayName); continue; }
    const text = `🔔 Напоминаю: ждём твоего ответа.\n\n${pollTextFor(db, poll, r.employeeId, now.date)}`;
    const keyboard = pollKeyboard(poll.id, null, r.employeeId === poll.createdBy);
    if (await notifyUser(bot, r.telegramUserId, text, keyboard)) delivered += 1;
    else unreachable.push(r.displayName);
  }
  return { delivered, silent: silent.length, unreachable };
}

async function remindTelegramPoll(bot: Bot, db: Db, poll: Poll) {
  const silent = pollRecipientRows(db, poll.id).filter((r) =>
    r.telegramPollChatId !== r.telegramUserId || !r.telegramChoices?.length);
  const unreachable: string[] = [];
  let delivered = 0;
  for (const r of silent) {
    const { telegramPollChatId: chatId, messageId } = r;
    const owner = getEmployeeById(db, r.employeeId);
    if (chatId == null || !owner?.isActive || owner.telegramUserId !== chatId || messageId == null) {
      unreachable.push(r.displayName);
      continue;
    }
    try {
      await bot.api.sendMessage(chatId, `🔔 Ждём твоего ответа в опросе «${poll.question}».`, {
        reply_parameters: { message_id: messageId },
        protect_content: true,
      });
      delivered += 1;
    } catch (err) {
      console.error("telegram poll reminder failed:", safeErrorMessage(err));
      unreachable.push(r.displayName);
    }
  }
  return { delivered, silent: silent.length, unreachable };
}

function telegramPollDeadline(poll: Poll, teamTz: string): number {
  if (poll.closesAt == null) {
    return Math.min(poll.createdAt.getTime(), Date.now()) + POLL_OPEN_MAX_DAYS * 24 * 60 * 60 * 1000;
  }
  const [date, start] = poll.closesAt.split("T");
  return shiftStartMs({ date: date!, start: start! }, teamTz);
}

async function sendTelegramPollInvites(bot: Bot, db: Db, poll: Poll, options: readonly string[], teamTz: string): Promise<number> {
  const deadline = telegramPollDeadline(poll, teamTz);
  const scope = `poll:${poll.id}` as const;
  let delivered = 0;
  for (const recipient of pollRecipientRows(db, poll.id)) {
    const { employeeId } = recipient;
    const chatId = recipient.telegramUserId;
    const fresh = getPoll(db, poll.id);
    // Telegram требует минимум пять секунд до close_date. Оставляем ещё две
    // на запрос, чтобы карточка не принимала голоса после срока в planer-bot.
    if (!fresh || fresh.closedAt || fresh.cancelledAt || deadline - Date.now() < 7_000) break;
    const owner = getEmployeeById(db, employeeId);
    if (chatId == null || !owner?.isActive || owner.telegramUserId !== chatId || recipient.telegramPollId != null) continue;
    const kb = new InlineKeyboard().text("📊 Итоги", `poll:r:${poll.id}`);
    if (employeeId === poll.createdBy) kb.row().text("🔒 Закрыть опрос", `poll:close:${poll.id}`);
    const sent = await bot.api.sendPoll(chatId, poll.question, options.map(text => ({ text })), {
      type: "regular",
      is_anonymous: false,
      allows_multiple_answers: poll.telegramMultiple,
      allows_revoting: true,
      protect_content: true,
      reply_markup: kb,
      close_date: Math.floor(deadline / 1000),
    }).catch(err => {
      console.error("telegram poll send failed:", safeErrorMessage(err));
      return null;
    });
    if (!sent?.poll?.id || sent.chat?.type !== "private" || sent.chat.id !== chatId
        || !Number.isSafeInteger(sent.message_id) || sent.message_id <= 0) continue;
    const { message_id: messageId } = sent;
    const needsStop = db.transaction((tx) => {
      setTelegramPollMessage(tx, poll.id, employeeId, { messageId, telegramPollId: sent.poll.id, telegramPollChatId: chatId });
      const current = getPoll(tx, poll.id);
      const target = getEmployeeById(tx, employeeId);
      // Закрытие или отвязка могли произойти, пока Telegram отвечал. Эта
      // карточка ещё не была известна обработчику закрытия.
      const activeTarget = target?.isActive && target.telegramUserId === chatId;
      if (current && !current.closedAt && !current.cancelledAt && activeTarget) return false;
      const messages: FoodCloseMessage[] = [{ employeeId, telegramUserId: chatId, messageId, stopPoll: true }];
      if (activeTarget && current && (current.closedAt || current.cancelledAt)) {
        messages.push({ employeeId, telegramUserId: chatId, ...telegramPollFinishMessage(current, current.cancelledAt ? "cancelled" : "closed") });
      }
      queueFoodCloseMessages(tx, scope, messages);
      return true;
    });
    delivered += 1;
    if (needsStop) await deliverFoodCloseMessages(db, bot, scope);
  }
  return delivered;
}

export async function sendPollInvites(bot: Bot, db: Db, poll: Poll, now: TeamClock, teamTz: string): Promise<number> {
  if (poll.telegramOptions) {
    const finishSending = beginTelegramPollSending(db, poll.id);
    if (!finishSending) return 0;
    try {
      return await sendTelegramPollInvites(bot, db, poll, poll.telegramOptions, teamTz);
    } finally {
      finishSending();
      if (getPoll(db, poll.id)?.closedAt) await deliverFoodCloseMessages(db, bot, `poll:${poll.id}`);
    }
  }
  let delivered = 0;
  for (const r of pollRecipientRows(db, poll.id)) {
    if (r.telegramUserId == null) continue;
    const messageId = await sendTracked(
      bot, r.telegramUserId, pollTextFor(db, poll, r.employeeId, now.date),
      pollKeyboard(poll.id, null, r.employeeId === poll.createdBy),
    );
    setPollMessageId(db, poll.id, r.employeeId, messageId);
    if (messageId != null) delivered += 1;
  }
  return delivered;
}

/**
 * Сохраняет задания на снятие старых кнопок и отправку итога.
 *
 * Гашение — косметика: письмо могли удалить, и ошибка правки не должна
 * помешать итогу дойти до остальных. Сервер всё равно откажет тапу по
 * закрытому опросу.
 */
export function queuePollCloseMessages(db: Db, poll: Poll, reason: FoodCloseReason): void {
  const recipients = pollRecipientRows(db, poll.id);
  if (poll.telegramOptions) {
    const messages: FoodCloseMessage[] = [];
    // Тормозим и прежние карточки архивных и отвязанных аккаунтов; итог
    // отправляется только тем, кто сейчас в команде.
    const ballots = db.select().from(pollRecipients).where(eq(pollRecipients.pollId, poll.id)).orderBy(pollRecipients.employeeId).all();
    for (const r of ballots) {
      if (r.telegramPollId == null || r.telegramPollChatId == null || r.messageId == null) continue;
      messages.push({ employeeId: r.employeeId, telegramUserId: r.telegramPollChatId, messageId: r.messageId, stopPoll: true });
    }
    const result = telegramPollFinishMessage(poll, reason);
    for (const r of recipients) {
      if (r.telegramPollId == null || r.telegramUserId == null || r.telegramUserId !== r.telegramPollChatId) continue;
      messages.push({ employeeId: r.employeeId, telegramUserId: r.telegramUserId, ...result });
    }
    queueFoodCloseMessages(db, `poll:${poll.id}`, messages);
    return;
  }
  const votes = db.select({ employeeId: pollVotes.employeeId, choice: pollVotes.choice })
    .from(pollVotes).where(eq(pollVotes.pollId, poll.id)).all();
  const text = reason === "closed"
    ? pollResultText(poll.question, pollTally(recipients, votes))
    : `🚫 Опрос отменён: ${poll.question}`;
  const messages: FoodCloseMessage[] = [];
  for (const r of recipients) {
    if (r.telegramUserId == null) continue;
    const to = { employeeId: r.employeeId, telegramUserId: r.telegramUserId };
    if (r.messageId != null) messages.push({ ...to, messageId: r.messageId });
    messages.push({ ...to, body: text });
  }
  queueFoodCloseMessages(db, `poll:${poll.id}`, messages);
}
