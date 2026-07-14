import { Bot } from "grammy";
import type { Db } from "../db/client";
import type { Config } from "../config";
import { linkTelegramAccount, getByTelegramId, getEmployeeById } from "../repo/employees";
import { acceptSwap, declineSwap } from "../swap/swap-service";
import { teamNow } from "../util/team-time";
import { notifyUser, notifyAdmins } from "./notify";

export interface BotDeps {
  db: Db;
  config: Config;
}

/** Maps a swap-service failure reason to a short Russian message for the tapping user. */
function reasonToRu(reason: string): string {
  if (reason === "not_pending") return "Уже обработано";
  if (reason === "not_yours") return "Это не твоя заявка";
  if (reason.startsWith("double-booking")) return "Пересекается с твоей сменой";
  if (reason === "not_found") return "Заявка не найдена";
  if (reason === "unavailable") return "Смена больше недоступна";
  if (reason === "from-shift-in-past" || reason === "to-shift-in-past") return "Смена уже прошла";
  return "Не получилось";
}

export function createBot(deps: BotDeps): Bot {
  const { db, config } = deps;
  const bot = new Bot(config.botToken);

  bot.command("start", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const token = ctx.match.trim();

    if (token) {
      const already = getByTelegramId(db, from.id);
      if (already) {
        await ctx.reply(`Ты уже привязан, ${already.displayName} 👋`);
        return;
      }
      const linked = linkTelegramAccount(db, token, from.id, from.username);
      if (linked) {
        await ctx.reply(`Готово, ${linked.displayName}! Ты в системе ✅ Открой мини-апп, чтобы посмотреть смены.`);
        return;
      }
      await ctx.reply("Ссылка недействительна или уже использована. Попроси у админа новую.");
      return;
    }

    const existing = getByTelegramId(db, from.id);
    if (existing) {
      await ctx.reply(`Привет, ${existing.displayName}! 👋 Открой мини-апп, чтобы посмотреть смены.`);
      return;
    }
    await ctx.reply("Ты пока не зарегистрирован. Попроси у админа ссылку-приглашение.");
  });

  bot.callbackQuery(/^swap:(accept|decline):(\d+)$/, async (ctx) => {
    const m = ctx.match;
    const action = m[1] as "accept" | "decline";
    const id = Number(m[2]);

    const me = getByTelegramId(db, ctx.from.id);
    if (!me) {
      await ctx.answerCallbackQuery({ text: "Ты не в системе" });
      return;
    }

    const res = action === "accept" ? acceptSwap(db, id, me.id, teamNow(config.teamTz)) : declineSwap(db, id, me.id);
    if (!res.ok) {
      await ctx.answerCallbackQuery({ text: reasonToRu(res.reason) });
      return;
    }

    await ctx.answerCallbackQuery({ text: action === "accept" ? "Принято ✅" : "Отклонено" });
    await ctx.editMessageText(action === "accept" ? "✅ Обмен принят — смены поменялись." : "✖ Обмен отклонён.");

    const initiatorTg = getEmployeeById(db, res.counterpartyId)?.telegramUserId;
    if (initiatorTg != null) {
      await notifyUser(bot, initiatorTg, action === "accept" ? "Твой обмен приняли ✅ Смены поменялись." : "Твой обмен отклонили.");
    }
    if (action === "accept") {
      await notifyAdmins(bot, db, "Обмен сменами состоялся.");
    }
  });

  bot.catch((err) => {
    console.error(`bot handler error (update ${err.ctx?.update?.update_id ?? "?"}):`, err.error);
  });

  return bot;
}
