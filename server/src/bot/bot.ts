import { Bot, InlineKeyboard } from "grammy";
import type { Db } from "../db/client";
import type { Config } from "../config";
import type { Employee } from "../db/schema";
import {
  linkTelegramAccount,
  getByTelegramId,
  getEmployeeById,
  createAdminEmployee,
  rememberTelegramProfile,
  setRemindersEnabled,
  restoreEmployee,
  setEmployeeAdmin,
} from "../repo/employees";
import { acceptSwap, declineSwap } from "../swap/swap-service";
import { expressInterest, confirmOffer, declineOffer } from "../weekend/weekend-service";
import { getVacantSlot } from "../repo/weekend";
import { recordAudit } from "../repo/audit";
import { issueToken } from "../auth/jwt";
import { teamNow } from "../util/team-time";
import { addressOf } from "@planer/shared";
import {
  notifyUser,
  notifyAdmins,
  swapAcceptedText,
  swapDeclinedText,
  swapAcceptedAdminText,
  swapAutoCancelledText,
  swapExpiredText,
  weekendConfirmedAdminText,
  weekendDeclinedAdminText,
} from "./notify";
import { slotLineOf, swapAuditPayload } from "../util/message-lines";
import { safeErrorMessage } from "../util/safe-error";

// How long an /admin magic link stays valid. It carries a full admin JWT in
// plain Telegram chat text — Telegram syncs history to every signed-in device
// and includes it in chat exports, so a copy sitting around for weeks is a
// standing liability. 12 hours covers a single working day (open it in the
// morning, still good after lunch) without needing single-use tokens or a
// revocation store; re-requesting is one more `/admin` message to the bot.
const ADMIN_LINK_TTL_SEC = 12 * 3600;

export interface BotDeps {
  db: Db;
  config: Config;
}

/** Maps a swap-service failure reason to a short Russian message for the tapping user. */
function reasonToRu(reason: string): string {
  if (reason === "not_pending") return "Уже обработано";
  if (reason === "not_yours") return "Это не твоя заявка";
  // Only the counterparty ever taps these buttons, so «твоей» is right for the
  // `-to` half and a lie for the `-from` half — that overlap is the initiator's.
  if (reason === "double-booking-to") return "Пересекается с твоей сменой";
  if (reason === "double-booking-from") return "У коллеги теперь пересечение по времени";
  if (reason === "not_found") return "Заявка не найдена";
  if (reason === "unavailable") return "Смена больше недоступна";
  if (reason === "from-shift-in-past" || reason === "to-shift-in-past") return "Смена уже прошла";
  // Reachable if a shift is edited (or reassigned by another swap) while this
  // one is still pending — the shift moved out from under the swap.
  if (reason === "from-shift-not-owned" || reason === "to-shift-not-owned") return "Смена уже досталась другому человеку";
  if (reason === "identical-shift") return "Смены теперь совпадают";
  return "Не получилось";
}

/** Runs a cosmetic Telegram edit (rewriting or dropping buttons after the
 *  fact) without letting a transient failure propagate. Every function in
 *  `notify.ts` already guards its own API call the same way; the edit calls
 *  below are the odd ones out, and an essential notification must never be
 *  lost because a decorative edit that came after it threw. */
async function safeEdit(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error("bot: cosmetic edit failed:", safeErrorMessage(err));
  }
}

/**
 * The command menu Telegram shows next to the input field. Only the two commands
 * everybody has: `/admin` is checked server-side anyway, and listing it for the
 * whole team would just invite taps that answer «только для администраторов».
 *
 * Without this, `/notifications` is a command nobody can discover — which would
 * defeat the point of the switch being self-service.
 */
export async function publishBotCommands(bot: Bot): Promise<void> {
  try {
    await bot.api.setMyCommands([
      { command: "start", description: "Начать и открыть смены" },
      { command: "notifications", description: "Напоминания о сменах — включить или выключить" },
    ]);
  } catch (err) {
    // A command menu is a nicety; never let it stop the bot from running.
    console.error("setMyCommands failed:", safeErrorMessage(err));
  }
}

/** The «напоминания включены/выключены» line, and the one button that flips it. */
export function remindersStateText(enabled: boolean): string {
  return enabled
    ? "🔔 Напоминания о сменах включены — пишу вечером накануне утренней, вечерней и ночной."
    : "🔕 Напоминания о сменах выключены — про смены не пишу.";
}

export function remindersKeyboard(enabled: boolean): InlineKeyboard {
  return enabled
    ? new InlineKeyboard().text("🔕 Отключить напоминания", "reminders:off")
    : new InlineKeyboard().text("🔔 Включить напоминания", "reminders:on");
}

export function createBot(deps: BotDeps): Bot {
  const { db, config } = deps;
  const bot = new Bot(config.botToken);

  /**
   * Whoever tapped, if they may still act.
   *
   * A button lives in a Telegram chat forever, so somebody archived *after* a
   * message was delivered kept a working entrance: they could record «хочу» on a
   * vacant weekend slot, confirm an offer, land in the payroll CSV and even have a
   * fresh `weekend_work` shift written for them — the very schedule archiving had
   * just taken them off. The HTTP layer refuses them at the door
   * (`middleware.ts`); this was the second, unguarded one.
   *
   * Allowlisted ids are the documented exception, exactly as in `/start` above:
   * `/api/auth` un-archives them on sight, so locking them out of a button would
   * be a dead end rather than a guard.
   */
  function acting(tgId: number): { ok: true; me: Employee } | { ok: false; text: string } {
    const me = getByTelegramId(db, tgId);
    if (!me) return { ok: false, text: "Ты не в системе" };
    if (!me.isActive && !config.adminTelegramIds.includes(tgId)) {
      return { ok: false, text: "Ты в архиве — напиши админу" };
    }
    return { ok: true, me };
  }

  bot.command("start", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const token = ctx.match.trim();

    if (token) {
      const already = getByTelegramId(db, from.id);
      if (already) {
        // Somebody who left and came back: their old row still holds this Telegram
        // id (and the unique index on it means no new row can take it), so a fresh
        // invite link cannot work no matter how many are issued. «Ты уже привязан»
        // was both untrue — they are not in the system in any usable sense — and a
        // dead end. The way out is the admin's «Восстановить», so say that.
        if (!already.isActive && !config.adminTelegramIds.includes(from.id)) {
          await ctx.reply("Ты в архиве — новая ссылка не поможет. Попроси админа восстановить твою запись, история и смены сохранятся.");
          return;
        }
        await ctx.reply(`Ты уже привязан, ${addressOf(already)} 👋`);
        return;
      }
      const linked = linkTelegramAccount(db, token, from.id, from.username, from.first_name);
      if (linked) {
        // Greet by their own name, but still name the roster row they just claimed:
        // an invite link can only be used once, so «я — не этот человек» has to be
        // catchable here. Skipped when the two names are the same word anyway.
        const address = addressOf(linked);
        const roster = address === linked.displayName ? "" : ` В расписании ты — ${linked.displayName}.`;
        await ctx.reply(`Готово, ${address}! Ты в системе ✅${roster} Открой мини-апп, чтобы посмотреть смены.`);
        return;
      }
      await ctx.reply("Ссылка недействительна или уже использована. Попроси у админа новую.");
      return;
    }

    const existing = getByTelegramId(db, from.id);
    if (existing) {
      // Archived and not on the allowlist: POST /api/auth would 403 them the
      // moment they opened the mini app, so the cheerful "открой мини-апп"
      // greeting is a promise this account can't keep. Say so honestly instead.
      // An allowlisted person is the one documented exception — /api/auth
      // restores them on sight (see its comment), so the normal greeting
      // below is still true for them and they must not be told they're locked out.
      if (!existing.isActive && !config.adminTelegramIds.includes(from.id)) {
        await ctx.reply("Ты в архиве — доступ в мини-апп закрыт. Если это ошибка, напиши админу.");
        return;
      }
      // Keep the greeting name current — people rename themselves in Telegram.
      rememberTelegramProfile(db, existing.id, { tgUsername: from.username, tgFirstName: from.first_name });
      await ctx.reply(`Привет, ${addressOf({ ...existing, tgFirstName: from.first_name })}! 👋 Открой мини-апп, чтобы посмотреть смены.`);
      return;
    }
    // Allowlisted admins self-register on first /start — no invite link needed.
    if (config.adminTelegramIds.includes(from.id)) {
      const displayName = [from.first_name, from.last_name].filter(Boolean).join(" ").trim() || from.username || "Админ";
      const admin = createAdminEmployee(db, {
        telegramUserId: from.id,
        tgUsername: from.username,
        tgFirstName: from.first_name,
        displayName,
      });
      await ctx.reply(`Привет, ${addressOf(admin)}! Ты вошёл как админ ✅ Открой мини-апп для управления сменами.`);
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

    // Archiving only ever flips `isActive` — it never touches `isAdmin` — so a
    // former admin who got archived still passes the guard below and would
    // otherwise get a fresh 12-hour token that 401s on every single request at
    // `requireAdmin`. Catch that here rather than handing out a dead link.
    if (admin && !admin.isActive) {
      if (!isAllowlisted) {
        await ctx.reply("Ты в архиве — админка недоступна. Если это ошибка, напиши другому админу.");
        return;
      }
      // Same restore-on-reauth as POST /api/auth (see its comment): a Telegram
      // id on ADMIN_TELEGRAM_IDS is trusted by the operator more than anything
      // the admin UI itself can grant, so being archived can't be a dead end
      // here either — restore before handing out a token that would actually work.
      admin = restoreEmployee(db, admin.id)!;
      if (!admin.isAdmin) admin = setEmployeeAdmin(db, admin.id, true) ?? admin;
      recordAudit(db, "employee_restored", admin.id, { employeeId: admin.id, displayName: admin.displayName, via: "allowlist_reauth" });
    }

    if ((!admin || !admin.isAdmin) && !isAllowlisted) {
      await ctx.reply("Админка доступна только администраторам.");
      return;
    }
    if (!admin && isAllowlisted) {
      const displayName = [from.first_name, from.last_name].filter(Boolean).join(" ").trim() || from.username || "Админ";
      admin = createAdminEmployee(db, {
        telegramUserId: from.id,
        tgUsername: from.username,
        tgFirstName: from.first_name,
        displayName,
      });
    }
    if (!admin) {
      await ctx.reply("Сначала отправь /start.");
      return;
    }
    const token = await issueToken({ employeeId: admin.id, isAdmin: true }, config.jwtSecret, ADMIN_LINK_TTL_SEC);
    const url = `${config.publicUrl}/admin/#token=${token}`;
    await ctx.reply(
      `Вход в админку (ссылка личная, не пересылай — действует 12 часов, потом попроси новую через /admin):\n${url}`,
      { link_preview_options: { is_disabled: true } },
    );
  });

  // /notifications — the setting, reachable at any time rather than only while a
  // reminder happens to be on screen.
  bot.command("notifications", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const who = acting(from.id);
    if (!who.ok) {
      await ctx.reply(who.text === "Ты не в системе" ? "Сначала отправь /start." : `${who.text}.`);
      return;
    }
    const me = who.me;
    await ctx.reply(remindersStateText(me.remindersEnabled), { reply_markup: remindersKeyboard(me.remindersEnabled) });
  });

  /**
   * Turns this person's shift reminders on or off. Scoped to whoever tapped it —
   * the callback carries no employee id, so nobody can mute a colleague.
   */
  bot.callbackQuery(/^reminders:(on|off)$/, async (ctx) => {
    const enabled = ctx.match[1] === "on";
    const who = acting(ctx.from.id);
    if (!who.ok) {
      await ctx.answerCallbackQuery({ text: who.text });
      return;
    }
    const me = who.me;
    setRemindersEnabled(db, me.id, enabled);
    await ctx.answerCallbackQuery({ text: enabled ? "Включил 🔔" : "Больше не буду 🔕" });
    if (!enabled) {
      // Essential: tell them where to turn these back on again. Sent before the
      // cosmetic button-swap below so a transient Telegram failure on that edit
      // can never cost them this.
      await ctx.reply("Напоминания о сменах выключены. Вернуть — командой /notifications или в мини-аппе, «Мои смены».");
    }
    // Only the buttons are rewritten: the reminder itself is still the useful part
    // of the message, and replacing it would delete tomorrow's shift time.
    await safeEdit(() => ctx.editMessageReplyMarkup({ reply_markup: remindersKeyboard(enabled) }));
  });

  bot.callbackQuery(/^swap:(accept|decline):(\d+)$/, async (ctx) => {
    const m = ctx.match;
    const action = m[1] as "accept" | "decline";
    const id = Number(m[2]);

    const who = acting(ctx.from.id);
    if (!who.ok) {
      await ctx.answerCallbackQuery({ text: who.text });
      return;
    }
    const me = who.me;

    const res = action === "accept" ? acceptSwap(db, id, me.id, teamNow(config.teamTz)) : declineSwap(db, id, me.id);
    if (!res.ok) {
      await ctx.answerCallbackQuery({ text: reasonToRu(res.reason) });
      // The tapper just read why in that toast. The initiator proposed this and
      // did nothing since — without a word here their request just turns
      // «Истекло» in the archive with no cause attached.
      if (res.expired) {
        const payload = swapAuditPayload(db, res.expired);
        recordAudit(db, "swap_expired", me.id, payload);
        const initiatorTg = getEmployeeById(db, res.expired.fromEmployeeId)?.telegramUserId;
        if (initiatorTg != null) await notifyUser(bot, initiatorTg, swapExpiredText(payload, "shift_changed"));
      }
      return;
    }

    await ctx.answerCallbackQuery({ text: action === "accept" ? "Принято ✅" : "Отклонено" });

    // Journal it exactly like the mini-app's own accept/decline route does
    // (same event type, same payload shape) — tapping the Telegram button is
    // the easier, more likely path, and it used to leave no trail at all.
    recordAudit(db, action === "accept" ? "swap_accepted" : "swap_declined", me.id, swapAuditPayload(db, res.request));

    // Essential notifications happen before the cosmetic edit further down —
    // a transient Telegram failure on that edit must never suppress the
    // initiator hearing about their swap, the admins hearing it happened, or a
    // bumped sibling proposal's counterparty hearing why their buttons died.
    const initiatorTg = getEmployeeById(db, res.counterpartyId)?.telegramUserId;
    if (initiatorTg != null) {
      await notifyUser(bot, initiatorTg, action === "accept" ? swapAcceptedText() : swapDeclinedText());
    }
    if (action === "accept") {
      await notifyAdmins(bot, db, swapAcceptedAdminText(swapAuditPayload(db, res.request)));
      // Accepting can silently auto-cancel other pending swaps that touched the
      // same shift(s). Both sides hear about it — the counterparty whose buttons
      // just died, and the initiator who has been waiting and would otherwise
      // read «Отменено» as their own doing. Same rule as the mini-app route.
      for (const sibling of res.cancelledSiblings ?? []) {
        // Its own journal event, not `swap_cancelled` — nobody withdrew these,
        // this accept knocked them out, and it is filed under whoever tapped.
        const payload = swapAuditPayload(db, sibling);
        recordAudit(db, "swap_auto_cancelled", me.id, payload);
        const text = swapAutoCancelledText(payload);
        for (const employeeId of [sibling.fromEmployeeId, sibling.toEmployeeId]) {
          const siblingTg = getEmployeeById(db, employeeId)?.telegramUserId;
          if (siblingTg != null) await notifyUser(bot, siblingTg, text);
        }
      }
    }

    // Only the buttons go stale here — the proposal text (who offered what) is
    // still exactly what the person needs to make sense of what just happened,
    // so leave it and just drop Принять/Отклонить.
    await safeEdit(() => ctx.editMessageReplyMarkup());
  });

  bot.callbackQuery(/^weekend:interest:(\d+)$/, async (ctx) => {
    const slotId = Number(ctx.match[1]);
    const who = acting(ctx.from.id);
    if (!who.ok) {
      await ctx.answerCallbackQuery({ text: who.text });
      return;
    }
    const me = who.me;
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
    const who = acting(ctx.from.id);
    if (!who.ok) {
      await ctx.answerCallbackQuery({ text: who.text });
      return;
    }
    const me = who.me;
    const res = action === "confirm" ? confirmOffer(db, id, me.id) : declineOffer(db, id, me.id);
    if (!res.ok) {
      const text = res.reason === "not_yours" ? "Это не твой оффер" : res.reason === "not_offered" ? "Уже обработано" : "Не получилось";
      await ctx.answerCallbackQuery({ text });
      return;
    }
    await ctx.answerCallbackQuery({ text: action === "confirm" ? "Беру ✅" : "Отказ" });

    // Essential: admins need to know, before the cosmetic edit below — a
    // transient Telegram failure on that edit must never swallow this.
    const slot = getVacantSlot(db, res.slotId);
    const slotLine = slot ? slotLineOf(slot) : "выходную смену";
    await notifyAdmins(
      bot,
      db,
      action === "confirm" ? weekendConfirmedAdminText(me.displayName, slotLine) : weekendDeclinedAdminText(me.displayName, slotLine),
    );

    // Only the buttons go stale — the offer text (which slot, which hours) is
    // still what the person needs, so leave it and just drop Беру/Не смогу.
    await safeEdit(() => ctx.editMessageReplyMarkup());
  });

  bot.catch((err) => {
    console.error(
      `bot handler error (update ${err.ctx?.update?.update_id ?? "?"}):`,
      safeErrorMessage(err.error),
    );
  });

  return bot;
}
