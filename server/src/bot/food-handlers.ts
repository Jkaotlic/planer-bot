import { InlineKeyboard, type Bot, type Context } from "grammy";
import { pollChoiceSchema } from "@planer/shared";
import type { Config } from "../config";
import type { Db } from "../db/client";
import type { Employee } from "../db/schema";
import { teamNow } from "../util/team-time";
import { safeErrorMessage } from "../util/safe-error";
import { castVote, closePoll, getPoll, listPollsFor, pollView } from "../polls/poll-service";
import { finishPollMessages, pollKeyboard, pollTextFor } from "../polls/poll-messenger";

export interface FoodHandlerDeps {
  db: Db;
  config: Config;
  acting(tgId: number): { ok: true; me: Employee } | { ok: false; text: string };
  actsAsAdmin(me: Employee, tgId: number): boolean;
}

/**
 * Вход в мини-апп — только inline-кнопками: из обычной клавиатуры Telegram не
 * отдаёт `initData`, и форма падала бы с 401 (см. `mainKeyboard`). Маршрут —
 * в query, а не во фрагменте: фрагмент Telegram занимает под `initData`.
 */
export function foodMenuKeyboard(publicUrl: string): InlineKeyboard {
  return new InlineKeyboard()
    .webApp("🍱 Новый заказ", `${publicUrl}/app/?screen=orders&new=order`)
    .webApp("🗳 Новый опрос", `${publicUrl}/app/?screen=orders&new=poll`)
    .row()
    .webApp("📋 Открыть", `${publicUrl}/app/?screen=orders`);
}

async function safeEdit(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error("bot: cosmetic edit failed:", safeErrorMessage(err));
  }
}

/**
 * Кнопки опросов и заказов еды.
 *
 * Вынесено из `bot.ts`, который и так больше полутора тысяч строк, но правила
 * те же: сначала «кто ты» (`acting`), потом «закрыто ли», потом «тебе ли» — в
 * том же порядке, что в HTTP, чтобы бот и мини-апп отказывали одинаково.
 *
 * Подключается ДО общего `callback_query:data` в `createBot`: тот отвечает
 * «Кнопка устарела» на всё, что до него не поймали.
 */
export function installFoodHandlers(bot: Bot, deps: FoodHandlerDeps): { sendFoodMenu(ctx: Context): Promise<void> } {
  const { db, config, acting, actsAsAdmin } = deps;
  const viewerOf = (me: Employee, tgId: number) => ({ id: me.id, isAdmin: actsAsAdmin(me, tgId) });

  async function sendFoodMenu(ctx: Context): Promise<void> {
    const from = ctx.from;
    if (!from) return;
    const who = acting(from.id);
    if (!who.ok) {
      await ctx.reply(who.text === "Ты не в системе" ? "Сначала отправь /start." : `${who.text}.`);
      return;
    }
    const now = teamNow(config.teamTz);
    const open = listPollsFor(db, viewerOf(who.me, from.id), now).filter((p) => p.open);
    const lines = open.length === 0
      ? ["Сейчас ничего не идёт."]
      : ["Сейчас идёт:", ...open.map((p) => `🗳 ${p.question}${p.closes ? ` (${p.closes})` : ""}`)];
    await ctx.reply(lines.join("\n"), { reply_markup: foodMenuKeyboard(config.publicUrl) });
  }

  bot.callbackQuery(/^poll:v:(\d+):(for|against|abstain)$/, async (ctx) => {
    const who = acting(ctx.from.id);
    if (!who.ok) { await ctx.answerCallbackQuery({ text: who.text }); return; }
    const poll = getPoll(db, Number(ctx.match[1]));
    if (!poll) { await ctx.answerCallbackQuery({ text: "Опрос удалён" }); return; }
    const choice = pollChoiceSchema.parse(ctx.match[2]);
    const now = teamNow(config.teamTz);
    const result = castVote(db, poll, who.me.id, choice, now);
    if (!result.ok) { await ctx.answerCallbackQuery({ text: result.error }); return; }
    await ctx.answerCallbackQuery({ text: "Голос принят ✓" });
    const manage = pollView(db, poll, viewerOf(who.me, ctx.from.id), now)?.canManage ?? false;
    await safeEdit(() => ctx.editMessageText(pollTextFor(db, poll, who.me.id, now.date), {
      reply_markup: pollKeyboard(poll.id, choice, manage && poll.createdBy === who.me.id),
    }));
  });

  bot.callbackQuery(/^poll:r:(\d+)$/, async (ctx) => {
    const who = acting(ctx.from.id);
    if (!who.ok) { await ctx.answerCallbackQuery({ text: who.text }); return; }
    const poll = getPoll(db, Number(ctx.match[1]));
    const view = poll ? pollView(db, poll, viewerOf(who.me, ctx.from.id), teamNow(config.teamTz)) : null;
    if (!view) { await ctx.answerCallbackQuery({ text: "Этот опрос тебе не приходил." }); return; }
    const t = view.tally;
    // Всплывашка, а не письмо: итог «на сейчас» нужен на секунду, а чат и так
    // получит полный итог с именами при закрытии.
    await ctx.answerCallbackQuery({
      text: `За ${t.for.length} · Против ${t.against.length} · Воздержались ${t.abstain.length} · Молчат ${t.silent.length}`,
      show_alert: true,
    });
  });

  bot.callbackQuery(/^poll:close:(\d+)$/, async (ctx) => {
    const who = acting(ctx.from.id);
    if (!who.ok) { await ctx.answerCallbackQuery({ text: who.text }); return; }
    const poll = getPoll(db, Number(ctx.match[1]));
    if (!poll) { await ctx.answerCallbackQuery({ text: "Опрос удалён" }); return; }
    const result = closePoll(db, poll, viewerOf(who.me, ctx.from.id));
    if (!result.ok) { await ctx.answerCallbackQuery({ text: result.error }); return; }
    await ctx.answerCallbackQuery({ text: "Опрос закрыт, итог разослан" });
    await finishPollMessages(bot, db, getPoll(db, poll.id)!, "closed");
  });

  return { sendFoodMenu };
}
