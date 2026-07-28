import { Bot, InlineKeyboard } from "grammy";
import type { Db } from "../db/client";
import { listAdmins, listActive } from "../repo/employees";
import { safeErrorMessage } from "../util/safe-error";

export async function notifyUser(bot: Bot, telegramUserId: number, text: string): Promise<boolean> {
  try {
    await bot.api.sendMessage(telegramUserId, text);
    return true;
  } catch (err) {
    console.error(`notifyUser: failed for ${telegramUserId}:`, safeErrorMessage(err));
    return false;
  }
}

/**
 * Sends a shift reminder with the button that turns these off.
 *
 * The switch also lives in the Mini App, but nobody goes looking for a setting
 * they didn't know existed — the moment somebody wants these to stop is the
 * moment one is in front of them, so that is where the button belongs.
 */
export async function notifyReminder(bot: Bot, telegramUserId: number, text: string): Promise<boolean> {
  const kb = new InlineKeyboard().text("🔕 Отключить напоминания", "reminders:off");
  try {
    await bot.api.sendMessage(telegramUserId, text, { reply_markup: kb });
    return true;
  } catch (err) {
    console.error(`notifyReminder: failed for ${telegramUserId}:`, safeErrorMessage(err));
    return false;
  }
}

/** Sends a swap proposal with inline Принять/Отклонить buttons routed to `swap:<action>:<requestId>` callbacks. */
export async function notifySwapProposal(bot: Bot, telegramUserId: number, requestId: number, text: string): Promise<void> {
  const kb = new InlineKeyboard().text("✅ Принять", `swap:accept:${requestId}`).text("✖ Отклонить", `swap:decline:${requestId}`);
  try {
    await bot.api.sendMessage(telegramUserId, text, { reply_markup: kb });
  } catch (err) {
    console.error(`notifySwapProposal: failed for ${telegramUserId}:`, safeErrorMessage(err));
  }
}

/** Broadcasts a new vacant weekend slot to every active worker, each with a "🙋 Хочу" button
 * routed to `weekend:interest:<slotId>`. */
export async function notifyVacantSlot(bot: Bot, db: Db, slotId: number, text: string): Promise<void> {
  const kb = new InlineKeyboard().text("🙋 Хочу", `weekend:interest:${slotId}`);
  for (const e of listActive(db)) {
    if (e.telegramUserId == null) continue;
    try {
      await bot.api.sendMessage(e.telegramUserId, text, { reply_markup: kb });
    } catch (err) {
      console.error(`notifyVacantSlot: failed for ${e.telegramUserId}:`, safeErrorMessage(err));
    }
  }
}

/** Sends a weekend-work offer with inline Беру/Не смогу buttons routed to
 * `weekend:confirm:<assignmentId>` / `weekend:decline:<assignmentId>` callbacks. */
export async function notifyWeekendOffer(bot: Bot, telegramUserId: number, assignmentId: number, text: string): Promise<void> {
  const kb = new InlineKeyboard().text("✅ Беру", `weekend:confirm:${assignmentId}`).text("✖ Не смогу", `weekend:decline:${assignmentId}`);
  try {
    await bot.api.sendMessage(telegramUserId, text, { reply_markup: kb });
  } catch (err) {
    console.error(`notifyWeekendOffer: failed for ${telegramUserId}:`, safeErrorMessage(err));
  }
}

export async function notifyAdmins(bot: Bot, db: Db, text: string): Promise<void> {
  for (const admin of listAdmins(db)) {
    if (admin.telegramUserId == null) continue;
    try {
      await bot.api.sendMessage(admin.telegramUserId, text);
    } catch (err) {
      console.error(`notifyAdmins: failed for ${admin.telegramUserId}:`, safeErrorMessage(err));
    }
  }
}
