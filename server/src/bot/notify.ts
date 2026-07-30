import { Bot, GrammyError, InlineKeyboard } from "grammy";
import type { Db } from "../db/client";
import { listAdmins, listActive } from "../repo/employees";
import { safeErrorMessage } from "../util/safe-error";
import type { SwapAuditPayload } from "../util/message-lines";

// --- Swap text builders ------------------------------------------------------
//
// Hand-copied into both `bot.ts` (the Telegram-button path) and `app.ts` (the
// mini-app path) used to be how these read — two literal strings that happened
// to agree today and had nothing keeping them that way. Both call sites import
// these instead, so a wording change can never land on only one path.

/** Sent to a swap's original initiator once the counterparty accepts it. */
export function swapAcceptedText(): string {
  return "Твой обмен приняли ✅ Смены поменялись.";
}

/** Sent to a swap's original initiator once the counterparty declines it. */
export function swapDeclinedText(): string {
  return "Твой обмен отклонили.";
}

/** Admin broadcast once a swap actually goes through. Named and dated, so with
 *  30 people on the team an admin can tell which swap this was. */
export function swapAcceptedAdminText(p: SwapAuditPayload): string {
  return `Обмен сменами состоялся: ${p.fromName} (${p.fromShift}) ↔ ${p.toName} (${p.toShift}).`;
}

/**
 * Sent to *both* sides of a different, still-pending proposal that got silently
 * auto-cancelled because one of its two shifts already changed hands via another
 * swap being accepted first.
 *
 * For the person holding the Принять/Отклонить buttons, without this the only
 * sign anything happened is that the buttons quietly stopped working — tapping
 * later just answers "Уже обработано". For the person who *proposed* it, it's
 * worse: they see «Отменено» on their own request, the very same pill they'd see
 * if they had withdrawn it themselves. Hence one text naming both sides, which
 * reads correctly whichever of the two is holding the phone.
 */
export function swapAutoCancelledText(p: SwapAuditPayload): string {
  return `Заявка на обмен отменилась — смена уже досталась другому человеку. Было: ${p.fromName} (${p.fromShift}) ↔ ${p.toName} (${p.toShift}).`;
}

/** Why a pending swap stopped being possible without anybody involved doing
 *  anything — an admin removed the entry under it, or replaced the whole month. */
export type SwapExpiryCause = "entry_deleted" | "roster_reimported";

/**
 * Sent to *both* sides of a pending swap an admin's edit just invalidated.
 *
 * Goes out to the initiator too, and that's the point: they proposed it and did
 * nothing since, so without this the request just turns «Истекло» in the archive
 * with no cause attached. Names both shifts because the row itself no longer can
 * — the pointer at the vanished entry is null from here on. One builder, one
 * clause that varies, because two near-identical strings are how these drift.
 */
export function swapExpiredText(p: SwapAuditPayload, cause: SwapExpiryCause): string {
  const why = cause === "entry_deleted" ? "смену удалили из расписания" : "график за этот период загрузили заново";
  return `Обмен неактуален: ${why}. Было: ${p.fromName} (${p.fromShift}) ↔ ${p.toName} (${p.toShift}).`;
}

// --- Weekend-offer text builders ---------------------------------------------

/** Admin broadcast once a worker confirms an offered weekend shift. */
export function weekendConfirmedAdminText(name: string, slotLine: string): string {
  return `${name} подтвердил(а) работу в выходной ✅ — ${slotLine}`;
}

/** Admin broadcast once a worker turns down an offered weekend shift. */
export function weekendDeclinedAdminText(name: string, slotLine: string): string {
  return `${name} отказался(лась) от работы в выходной — ${slotLine}`;
}

/** Sent to a worker an admin just took off a weekend slot — the reverse
 *  direction (worker declines) already notifies the admin; this closes the
 *  loop so the worker doesn't just find their shift gone. */
export function weekendUnassignedText(slotLine: string): string {
  return `Тебя сняли с выходной смены: ${slotLine}. Если это неожиданно — спроси у админа.`;
}

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
 * How a send ended, for callers that retry.
 *
 * `permanent` separates «Telegram is busy, ask again» from «this chat will never
 * open». Only the caller knows what to do with each, so the distinction is
 * reported rather than acted on here.
 */
export type SendOutcome = { ok: true } | { ok: false; permanent: boolean; errorCode?: number };

/**
 * Whether repeating this exact call could ever succeed.
 *
 * 403 is a blocked bot or a deleted account; 400 is «chat not found» and friends.
 * Both are answers about the chat, not about the moment — a retry sends the same
 * request to the same closed door. Everything else (429 «too many requests», 5xx,
 * a dropped connection) is worth another try, which is why a plain network error
 * deliberately reads as non-permanent.
 */
export function isPermanentSendFailure(err: unknown): boolean {
  return err instanceof GrammyError && (err.error_code === 403 || err.error_code === 400);
}

/**
 * Sends a shift reminder with the button that turns these off.
 *
 * The switch also lives in the Mini App, but nobody goes looking for a setting
 * they didn't know existed — the moment somebody wants these to stop is the
 * moment one is in front of them, so that is where the button belongs.
 */
export async function notifyReminder(bot: Bot, telegramUserId: number, text: string): Promise<SendOutcome> {
  const kb = new InlineKeyboard().text("🔕 Отключить напоминания", "reminders:off");
  try {
    await bot.api.sendMessage(telegramUserId, text, { reply_markup: kb });
    return { ok: true };
  } catch (err) {
    console.error(`notifyReminder: failed for ${telegramUserId}:`, safeErrorMessage(err));
    return {
      ok: false,
      permanent: isPermanentSendFailure(err),
      errorCode: err instanceof GrammyError ? err.error_code : undefined,
    };
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
