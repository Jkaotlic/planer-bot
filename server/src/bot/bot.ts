import { Bot } from "grammy";
import type { Db } from "../db/client";
import type { Config } from "../config";
import { linkTelegramAccount, getByTelegramId } from "../repo/employees";

export interface BotDeps {
  db: Db;
  config: Config;
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

  bot.catch((err) => {
    console.error(`bot handler error (update ${err.ctx?.update?.update_id ?? "?"}):`, err.error);
  });

  return bot;
}
