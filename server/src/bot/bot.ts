import { Bot } from "grammy";
import type { Db } from "../db/client";
import type { Config } from "../config";
import { linkTelegramAccount, getByTelegramId, getEmployeeById, createAdminEmployee } from "../repo/employees";
import { acceptSwap, declineSwap } from "../swap/swap-service";
import { expressInterest, confirmOffer, declineOffer } from "../weekend/weekend-service";
import { issueToken } from "../auth/jwt";
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
    // Allowlisted admins self-register on first /start — no invite link needed.
    if (config.adminTelegramIds.includes(from.id)) {
      const displayName = [from.first_name, from.last_name].filter(Boolean).join(" ").trim() || from.username || "Админ";
      const admin = createAdminEmployee(db, { telegramUserId: from.id, tgUsername: from.username, displayName });
      await ctx.reply(`Привет, ${admin.displayName}! Ты вошёл как админ ✅ Открой мини-апп для управления сменами.`);
      return;
    }
    await ctx.reply("Ты пока не зарегистрирован. Попроси у админа ссылку-приглашение.");
  });

  // /admin — hands an admin a browser login link for the desktop console.
  // The link carries a long-lived admin JWT the /admin SPA reads from the URL
  // hash; opening the console from inside Telegram still works via initData.
  bot.command("admin", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const isAllowlisted = config.adminTelegramIds.includes(from.id);
    let admin = getByTelegramId(db, from.id);
    if ((!admin || !admin.isAdmin) && !isAllowlisted) {
      await ctx.reply("Админка доступна только администраторам.");
      return;
    }
    if (!admin && isAllowlisted) {
      const displayName = [from.first_name, from.last_name].filter(Boolean).join(" ").trim() || from.username || "Админ";
      admin = createAdminEmployee(db, { telegramUserId: from.id, tgUsername: from.username, displayName });
    }
    if (!admin) {
      await ctx.reply("Сначала отправь /start.");
      return;
    }
    const token = await issueToken({ employeeId: admin.id, isAdmin: true }, config.jwtSecret, 30 * 24 * 3600);
    const url = `${config.publicUrl}/admin/#token=${token}`;
    await ctx.reply(
      `Вход в админку (ссылка личная, действует 30 дней — не пересылай):\n${url}`,
      { link_preview_options: { is_disabled: true } },
    );
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

  bot.callbackQuery(/^weekend:interest:(\d+)$/, async (ctx) => {
    const slotId = Number(ctx.match[1]);
    const me = getByTelegramId(db, ctx.from.id);
    if (!me) {
      await ctx.answerCallbackQuery({ text: "Ты не в системе" });
      return;
    }
    const res = expressInterest(db, slotId, me.id);
    if (!res.ok) {
      await ctx.answerCallbackQuery({ text: res.reason === "not_open" ? "Уже разобрали" : "Слот не найден" });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Записал 🙋" });
    await ctx.editMessageReplyMarkup(); // drop the button — interest recorded
  });

  bot.callbackQuery(/^weekend:(confirm|decline):(\d+)$/, async (ctx) => {
    const action = ctx.match[1] as "confirm" | "decline";
    const id = Number(ctx.match[2]);
    const me = getByTelegramId(db, ctx.from.id);
    if (!me) {
      await ctx.answerCallbackQuery({ text: "Ты не в системе" });
      return;
    }
    const res = action === "confirm" ? confirmOffer(db, id, me.id) : declineOffer(db, id, me.id);
    if (!res.ok) {
      const text = res.reason === "not_yours" ? "Это не твой оффер" : res.reason === "not_offered" ? "Уже обработано" : "Не получилось";
      await ctx.answerCallbackQuery({ text });
      return;
    }
    await ctx.answerCallbackQuery({ text: action === "confirm" ? "Беру ✅" : "Отказ" });
    await ctx.editMessageText(action === "confirm" ? "✅ Ты подтвердил работу в выходной." : "✖ Ты отказался от работы в выходной.");
    await notifyAdmins(bot, db, action === "confirm" ? "Работник подтвердил работу в выходной ✅" : "Работник отказался от работы в выходной.");
  });

  bot.catch((err) => {
    console.error(`bot handler error (update ${err.ctx?.update?.update_id ?? "?"}):`, err.error);
  });

  return bot;
}
