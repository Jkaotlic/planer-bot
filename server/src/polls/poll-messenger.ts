import { InlineKeyboard, type Bot } from "grammy";
import {
  POLL_CHOICE_LABEL, POLL_CHOICES, closesLabel, isOpenAt, pollInviteText, pollResultText, pollTally, type PollChoice,
} from "@planer/shared";
import type { Db } from "../db/client";
import { employees, pollVotes, type Poll } from "../db/schema";
import { eq } from "drizzle-orm";
import { sendTracked } from "../bot/tracked-send";
import { notifyUser } from "../bot/notify";
import { safeErrorMessage } from "../util/safe-error";
import { pollRecipientRows, setPollMessageId, voteOf, type TeamClock } from "./poll-service";

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

function creatorName(db: Db, poll: Poll): string {
  return db.select({ name: employees.displayName }).from(employees).where(eq(employees.id, poll.createdBy)).get()?.name ?? "Коллега";
}

/** Текст письма опроса для конкретного человека — и при рассылке, и после его тапа. */
export function pollTextFor(db: Db, poll: Poll, employeeId: number, today: string): string {
  return pollInviteText({
    creatorName: creatorName(db, poll),
    question: poll.question,
    closes: closesLabel(poll.closesAt, today),
    myChoice: voteOf(db, poll.id, employeeId),
  });
}

/**
 * Перерисовать письмо опроса одного человека — после его голоса в мини-аппе,
 * чтобы «Твой голос» и «✓» на кнопке не врали до следующего тапа в чате.
 * Косметика, как `redrawOrderMessage`: ошибки — в лог, закрытый опрос не
 * трогаем (кнопки уже погашены `finishPollMessages`).
 */
export async function redrawPollMessage(bot: Bot, db: Db, poll: Poll, employeeId: number, now: TeamClock): Promise<void> {
  try {
    if (!isOpenAt(poll, now)) return;
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

export async function sendPollInvites(bot: Bot, db: Db, poll: Poll, now: TeamClock): Promise<number> {
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
 * Гасит кнопки во всех разосланных письмах и рассылает итог.
 *
 * Гашение — косметика: письмо могли удалить, и ошибка правки не должна
 * помешать итогу дойти до остальных. Сервер всё равно откажет тапу по
 * закрытому опросу.
 */
export async function finishPollMessages(bot: Bot, db: Db, poll: Poll, reason: "closed" | "cancelled"): Promise<void> {
  const recipients = pollRecipientRows(db, poll.id);
  const votes = db.select({ employeeId: pollVotes.employeeId, choice: pollVotes.choice })
    .from(pollVotes).where(eq(pollVotes.pollId, poll.id)).all();
  const text = reason === "closed"
    ? pollResultText(poll.question, pollTally(recipients, votes))
    : `🚫 Опрос отменён: ${poll.question}`;
  for (const r of recipients) {
    if (r.telegramUserId == null) continue;
    if (r.messageId != null) {
      try {
        await bot.api.editMessageReplyMarkup(r.telegramUserId, r.messageId, { reply_markup: new InlineKeyboard() });
      } catch (err) {
        console.error("poll: cosmetic edit failed:", safeErrorMessage(err));
      }
    }
    await notifyUser(bot, r.telegramUserId, text);
  }
}
