import { Bot, InlineKeyboard } from "grammy";
import type { Db } from "../db/client";
import { listAdmins } from "../repo/employees";

export async function notifyUser(bot: Bot, telegramUserId: number, text: string): Promise<void> {
  try {
    await bot.api.sendMessage(telegramUserId, text);
  } catch (err) {
    console.error(`notifyUser: failed for ${telegramUserId}:`, err);
  }
}

/** Sends a swap proposal with inline Принять/Отклонить buttons routed to `swap:<action>:<requestId>` callbacks. */
export async function notifySwapProposal(bot: Bot, telegramUserId: number, requestId: number, text: string): Promise<void> {
  const kb = new InlineKeyboard().text("✅ Принять", `swap:accept:${requestId}`).text("✖ Отклонить", `swap:decline:${requestId}`);
  try {
    await bot.api.sendMessage(telegramUserId, text, { reply_markup: kb });
  } catch (err) {
    console.error(`notifySwapProposal: failed for ${telegramUserId}:`, err);
  }
}

export async function notifyAdmins(bot: Bot, db: Db, text: string): Promise<void> {
  for (const admin of listAdmins(db)) {
    if (admin.telegramUserId == null) continue;
    try {
      await bot.api.sendMessage(admin.telegramUserId, text);
    } catch (err) {
      console.error(`notifyAdmins: failed for ${admin.telegramUserId}:`, err);
    }
  }
}
