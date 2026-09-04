import { Bot, InlineKeyboard, InputFile, Keyboard, type Context } from "grammy";
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
  setWeekLegend,
  restoreEmployee,
  setEmployeeAdmin,
} from "../repo/employees";
import { acceptSwap, declineSwap } from "../swap/swap-service";
import { expressInterest, confirmOffer, declineOffer } from "../weekend/weekend-service";
import { declineHandover, takeHandover } from "../handover/handover-service";
import { createHandoverMessenger } from "../handover/handover-messenger";
import { getVacantSlot } from "../repo/weekend";
import { getCollection, previewCollection, setCollectionClosed, updateCollection } from "../collections/collection-service";
import { setNoticeMuted } from "../repo/notice-prefs";
import { recordAudit } from "../repo/audit";
import { issueToken } from "../auth/jwt";
import { teamNow } from "../util/team-time";
import { addressOf, addDaysIso, mondayOfIso, ADMIN_NOTICE_KINDS, ADMIN_NOTICE_LABELS, autoSendDateFor, autoSendLabel, canAnnounce, canAddOwnShifts } from "@planer/shared";
import { buildWeekImage, type WeekImage } from "./week-image";
import { buildQrImage } from "./qr-image";
import { mainKeyboard, BTN_WEEK, BTN_MY_SHIFTS, BTN_REMINDERS, BTN_ADMIN, BTN_BUG } from "./keyboard";
import {
  notifyUser,
  notifyAdmins,
  notifyBugReport,
  swapAcceptedText,
  swapDeclinedText,
  swapAcceptedAdminText,
  dutyNoticeForAdmins,
  swapAutoCancelledText,
  swapExpiredText,
  weekendConfirmedAdminText,
  weekendDeclinedAdminText,
} from "./notify";
import { slotLineOf, swapAuditPayload } from "../util/message-lines";
import { outsidePoolFacts } from "../swap/duty-notice";
import { safeErrorMessage } from "../util/safe-error";
import { openBugPrompt, getBugPending, clearBugPending, shouldCapture, submitBugReport, resolveBugReport } from "../bugs/bug-service";
import { getChecklist, listChecklists, updateChecklist } from "../repo/checklists";
import { clearDocPending, docPendingFor, startDocPending } from "../bugs/doc-pending";
import { attachLink, extractUrl, linkAcceptedMessage, notifyLinkReady } from "../collections/link-capture";
import { ensureBirthdayRound, linkCandidates, type LinkCandidate } from "../birthdays/birthday-service";
import { clearLinkPending, linkPendingFor, setLinkPending } from "../repo/link-pending";

// How long an /admin magic link stays valid. It carries a full admin JWT in
// plain Telegram chat text — Telegram syncs history to every signed-in device
// and includes it in chat exports, so a copy sitting around for weeks is a
// standing liability. 12 hours covers a single working day (open it in the
// morning, still good after lunch) without needing single-use tokens or a
// revocation store; re-requesting is one more `/admin` message to the bot.
const ADMIN_LINK_TTL_SEC = 12 * 3600;

/**
 * How far a person can page away from the current week. Half a year each way
 * covers everything the picture is ever opened for; without a limit the button
 * would walk someone into 2043, where there's no schedule and never will be.
 */
export const WEEK_OFFSET_LIMIT = 26;

/**
 * The buttons under the picture. The offset in the callback data is absolute —
 * weeks from TODAY, not from the week the picture showed: the message lives in
 * the chat forever, and a button tapped a month later has to count from the day
 * it's tapped, not from whatever day it was when the message was sent. Telegram
 * itself will only let editMessageMedia touch a message younger than 48 hours,
 * though — past that window a tap can't redraw anything, and a fresh /week is
 * the only way back in.
 */
/**
 * Кнопки под картинкой недели: листание и переключатель расшифровки букв.
 *
 * Расшифровка переключается здесь, а не в настройках: результат виден в том же
 * сообщении, и «попробовать без неё» — одно нажатие, а не поход в другое меню.
 * Подпись говорит, что случится по нажатию, а не что включено сейчас.
 */
function weekKeyboard(offset: number, legendOn: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (offset > -WEEK_OFFSET_LIMIT) keyboard.text("‹ Пред.", `week:${offset - 1}`);
  // One tap back home: from week 26, walking back on foot is 26 taps.
  if (offset !== 0) keyboard.text("⌂ Текущая", "week:0");
  if (offset < WEEK_OFFSET_LIMIT) keyboard.text("След. ›", `week:${offset + 1}`);
  keyboard.row().text(legendOn ? "🔤 Скрыть расшифровку" : "🔤 Показать расшифровку", `week:legend:${offset}`);
  // Замены случаются уже после того, как картинка прислана. Без этой кнопки
  // свежий график добывали в два нажатия — «След.» и обратно «Текущая», а на
  // соседней неделе такого обходного пути и вовсе нет. Кнопка целит в ту
  // неделю, что на экране, а не в текущую.
  keyboard.row().text("↻ Обновить", `week:refresh:${offset}`);
  return keyboard;
}

export interface BotDeps {
  db: Db;
  config: Config;
}

/** Maps a swap-service failure reason to a short Russian message for the tapping user. */
export function reasonToRu(reason: string): string {
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
  if (reason === "swaps-locked") return "Обмены сейчас закрыты админом";
  // Reason names are from the request POV (from/to), but the reader is always
  // the counterparty. The reader sees: from-excluded = colleague excluded, to-excluded = you excluded.
  if (reason === "from-excluded") return "Коллеге закрыли обмены смен";
  if (reason === "to-excluded") return "Тебе закрыли обмены смен";
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
 * The command menu Telegram shows next to the input field. Only the three commands
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
      { command: "week", description: "График команды на неделю" },
      { command: "menu", description: "Вернуть кнопки под полем ввода" },
      { command: "notifications", description: "Напоминания о сменах — включить или выключить" },
    ]);
  } catch (err) {
    // A command menu is a nicety; never let it stop the bot from running.
    console.error("setMyCommands failed:", safeErrorMessage(err));
  }
}

/**
 * The «напоминания включены/выключены» line, and the one button that flips it.
 *
 * Выключенное состояние называет и то, что НЕ выключается: чек-лист дежурного —
 * рабочая инструкция на смену, и он приходит всё равно. Пока это молчало, трое
 * отписались от вечерних напоминаний и на месяц потеряли инструкцию, ни разу об
 * этом не узнав (2026-08-28).
 */
export function remindersStateText(enabled: boolean): string {
  return enabled
    ? "🔔 Напоминания о сменах включены — пишу вечером накануне утренней, вечерней и ночной."
    : "🔕 Напоминания о сменах выключены — про смены не пишу. Чек-лист дежурного приходит всё равно: это рабочая инструкция на смену.";
}

export function remindersKeyboard(enabled: boolean): InlineKeyboard {
  return enabled
    ? new InlineKeyboard().text("🔕 Отключить напоминания", "reminders:off")
    : new InlineKeyboard().text("🔔 Включить напоминания", "reminders:on");
}

/**
 * Входы в мини-апп: список смен, до трёх форм самозаписи и — только у тех,
 * кто может слать анонсы (`canAnnounce`: админы и наблюдатели) — экран
 * анонсов.
 *
 * Именно inline-кнопками, и это единственный способ, а не выбор оформления.
 * Мини-апп, запущенный из кнопки *обычной* клавиатуры, не получает `initData` —
 * Telegram оставляет поле пустым «if the Mini App was launched from a keyboard
 * button or from inline mode», — поэтому `POST /api/auth` отвечает такому входу
 * 401 у всех без исключения. Из inline-кнопки подпись приходит. Сторож, чтобы
 * кнопки не переехали обратно на клавиатуру, — в `keyboard.test.ts`.
 *
 * Адрес формы — строкой запроса, а не фрагментом: фрагмент у мини-аппа занят
 * самим Telegram, `initData` приезжает именно в нём.
 *
 * Формы во второй строке, а не в первой: смены смотрят каждый день, а
 * больничный ставят несколько раз в год. Функция не знает сама, кто перед
 * ней — решает вызывающий (`sendMiniApp`), тем же правилом, что и `menuFor`.
 *
 * «📅 Своя смена» — той же строкой, что «Больничный»/«Мероприятие»: та же
 * форма самозаписи, третья по счёту. `?screen=shift` на мини-апповой стороне
 * (`SelfEntryScreen.screenFromSearch`) открывает её напрямую, а
 * `App.tsx` повторно проверяет `canAddOwnShifts(me)` при загрузке — ссылку
 * могли переслать, а тумблер выключить между открытием меню бота и тапом.
 */
export function miniAppKeyboard(publicUrl: string, opts: { canAnnounce: boolean; canAddOwnShifts: boolean }): InlineKeyboard {
  const kb = new InlineKeyboard()
    .webApp("📋 Открыть смены", `${publicUrl}/app/`)
    .row()
    .webApp("🤒 Больничный", `${publicUrl}/app/?screen=sick`)
    .webApp("📌 Мероприятие", `${publicUrl}/app/?screen=event`);
  if (opts.canAddOwnShifts) kb.webApp("📅 Своя смена", `${publicUrl}/app/?screen=shift`);
  // `canAnnounce`, не `isAdmin`: наблюдатель шлёт анонсы (задача 6), и кнопка,
  // видимая только админу, спрятала бы вход в его же законную вкладку.
  if (opts.canAnnounce) kb.row().webApp("📣 Анонс", `${publicUrl}/app/?screen=announce`);
  return kb;
}

/** Кнопки под подтверждением: подвинуть день или отказаться от автоотправки. */
function autoSendKeyboard(collectionId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✏️ Другой день", `collection:autoday:${collectionId}`)
    .row()
    .text("🚫 Не рассылать сам", `collection:autooff:${collectionId}`);
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

  /**
   * Действует ли этот человек как админ.
   *
   * Два источника прав, и оба обязаны спрашиваться вместе: флаг в базе и
   * `ADMIN_TELEGRAM_IDS` (его решение от 2026-07-30 — список даёт права). Правило
   * стояло тремя одинаковыми выражениями подряд, каждое со своим `!`, а
   * рассогласование здесь означало бы админскую кнопку, работающую у одного и
   * молчащую у другого.
   *
   * Не путать с чистой проверкой `adminTelegramIds.includes(...)` ниже: та отвечает
   * на другой вопрос — «пускать ли архивного», задокументированное исключение.
   */
  function actsAsAdmin(me: Employee, tgId: number): boolean {
    return me.isAdmin || config.adminTelegramIds.includes(tgId);
  }

  /** Что можно доложить к текстовому ответу: у `/admin` это отключённое превью ссылки. */
  type MenuExtra = { link_preview_options?: { is_disabled: boolean } };

  /**
   * Клавиатура для этого человека — или ничего, если слать её некому.
   *
   * Три отказа. Групповой чат: клавиатуру увидели бы все участники, а бот и так
   * не рассказывает там про график (`/week` молчит по той же причине). Человек
   * не в системе и архивный: нажимать им нечего, а «Мои смены» привели бы их в
   * мини-апп, который отвечает им 403.
   *
   * Аллоулистнутый (`ADMIN_TELEGRAM_IDS`) — то же документированное исключение,
   * что и везде в этом файле: `/api/auth` восстанавливает его при входе, поэтому
   * архивным он здесь не считается и админскую кнопку получает сразу — `/admin`
   * ему отвечает, а до первого обращения его строка ещё говорит `isAdmin: false`.
   */
  function menuFor(tgId: number, chatType: string | undefined): Keyboard | undefined {
    if (chatType !== "private") return undefined;
    const me = getByTelegramId(db, tgId);
    if (!me) return undefined;
    const allowlisted = config.adminTelegramIds.includes(tgId);
    if (!me.isActive && !allowlisted) return undefined;
    return mainKeyboard({ isAdmin: me.isAdmin || allowlisted });
  }

  /**
   * Текстовый ответ с постоянной клавиатурой.
   *
   * Только текстовый: у сообщения ровно одно поле `reply_markup`, и у `/week`
   * с `/notifications` оно уже занято листалкой недель и переключателем
   * напоминаний. Прицепить к ним ещё и клавиатуру нельзя физически — она едет
   * с теми ответами, где это поле свободно.
   *
   * Кому она достанется, решает `menuFor`, а не место вызова: половина ответов
   * ниже адресована людям, которым клавиатура не положена, и разбирать это на
   * каждой строчке значило бы завести восемь копий одного правила.
   */
  async function replyWithMenu(ctx: Context, text: string, extra?: MenuExtra): Promise<void> {
    const tgId = ctx.from?.id;
    await ctx.reply(text, {
      ...extra,
      reply_markup: tgId == null ? undefined : menuFor(tgId, ctx.chat?.type),
    });
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
          await replyWithMenu(ctx, "Ты в архиве — новая ссылка не поможет. Попроси админа восстановить твою запись, история и смены сохранятся.");
          return;
        }
        await replyWithMenu(ctx, `Ты уже привязан, ${addressOf(already)} 👋`);
        return;
      }
      const linked = linkTelegramAccount(db, token, from.id, from.username, from.first_name);
      if (linked) {
        // Greet by their own name, but still name the roster row they just claimed:
        // an invite link can only be used once, so «я — не этот человек» has to be
        // catchable here. Skipped when the two names are the same word anyway.
        const address = addressOf(linked);
        const roster = address === linked.displayName ? "" : ` В расписании ты — ${linked.displayName}.`;
        await replyWithMenu(ctx, `Готово, ${address}! Ты в системе ✅${roster} Открой мини-апп, чтобы посмотреть смены.`);
        return;
      }
      await replyWithMenu(ctx, "Ссылка недействительна или уже использована. Попроси у админа новую.");
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
        await replyWithMenu(ctx, "Ты в архиве — доступ в мини-апп закрыт. Если это ошибка, напиши админу.");
        return;
      }
      // Keep the greeting name current — people rename themselves in Telegram.
      rememberTelegramProfile(db, existing.id, { tgUsername: from.username, tgFirstName: from.first_name });
      await replyWithMenu(ctx, `Привет, ${addressOf({ ...existing, tgFirstName: from.first_name })}! 👋 Открой мини-апп, чтобы посмотреть смены.`);
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
      await replyWithMenu(ctx, `Привет, ${addressOf(admin)}! Ты вошёл как админ ✅ Открой мини-апп для управления сменами.`);
      return;
    }
    await replyWithMenu(ctx, "Ты пока не зарегистрирован. Попроси у админа ссылку-приглашение.");
  });

  /**
   * Hands an admin a browser login link for the desktop console. The link
   * carries a long-lived admin JWT the /admin SPA reads from the URL hash;
   * opening the console from inside Telegram still works via initData.
   *
   * Вынесено из обработчика, чтобы команда и кнопка клавиатуры звали одно и то
   * же: два входа, отвечающие по-разному на один вопрос, — наблюдаемый дефект,
   * а не мелочь.
   */
  async function sendAdminLink(ctx: Context): Promise<void> {
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
        await replyWithMenu(ctx, "Ты в архиве — админка недоступна. Если это ошибка, напиши другому админу.");
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
      await replyWithMenu(ctx, "Админка доступна только администраторам.");
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
      await replyWithMenu(ctx, "Сначала отправь /start.");
      return;
    }
    // The link below claims `isAdmin: true`, and `requireAdmin` believes the row,
    // not the token — so an allowlisted worker who was never promoted got a link
    // that 403'd on every request behind it. ADMIN_TELEGRAM_IDS means admin; make
    // the row say so, exactly as the restore branch above and POST /api/auth do.
    if (isAllowlisted && !admin.isAdmin) {
      admin = setEmployeeAdmin(db, admin.id, true) ?? admin;
      recordAudit(db, "employee_admin_changed", admin.id, {
        employeeId: admin.id,
        displayName: admin.displayName,
        isAdmin: true,
        via: "allowlist",
      });
    }
    const token = await issueToken({ employeeId: admin.id, isAdmin: true }, config.jwtSecret, ADMIN_LINK_TTL_SEC);
    const url = `${config.publicUrl}/admin/#token=${token}`;
    await replyWithMenu(
      ctx,
      `Вход в админку (ссылка личная, не пересылай — действует 12 часов, потом попроси новую через /admin):\n${url}`,
      { link_preview_options: { is_disabled: true } },
    );
  }

  bot.command("admin", (ctx) => sendAdminLink(ctx));

  /**
   * The reminders setting, reachable at any time rather than only while a
   * reminder happens to be on screen.
   *
   * Отвечает через `ctx.reply`, а не `replyWithMenu`, и это не недосмотр: у
   * успешного ответа поле `reply_markup` уже занято переключателем напоминаний,
   * а отказ адресован тому, кому `menuFor` всё равно вернул бы `undefined`.
   */
  async function sendReminders(ctx: Context): Promise<void> {
    const from = ctx.from;
    if (!from) return;
    const who = acting(from.id);
    if (!who.ok) {
      await ctx.reply(who.text === "Ты не в системе" ? "Сначала отправь /start." : `${who.text}.`);
      return;
    }
    const me = who.me;
    await ctx.reply(remindersStateText(me.remindersEnabled), { reply_markup: remindersKeyboard(me.remindersEnabled) });
  }

  bot.command("notifications", (ctx) => sendReminders(ctx));

  /**
   * Вход в мини-апп по кнопке «Мои смены».
   *
   * Отказы те же и теми же словами, что у `sendReminders`: человек не в системе
   * или в архиве — мини-апп ответил бы ему 403, так что кнопок он не получает
   * вовсе, а не получает их и натыкается на отказ уже внутри.
   *
   * Через `ctx.reply`, а не `replyWithMenu`, по той же причине, что и
   * напоминания: `reply_markup` здесь занят inline-кнопками.
   */
  async function sendMiniApp(ctx: Context): Promise<void> {
    const from = ctx.from;
    if (!from) return;
    const who = acting(from.id);
    if (!who.ok) {
      await ctx.reply(who.text === "Ты не в системе" ? "Сначала отправь /start." : `${who.text}.`);
      return;
    }
    await ctx.reply("Что открыть:", {
      // `actsAsAdmin` — тот же аллоулист-фолбэк, что и у остальных админских
      // проверок в этом файле: `ADMIN_TELEGRAM_IDS` даёт права до того, как
      // строка в базе о них узнает, и потерять это здесь — значит на время
      // спрятать кнопку от живого админа.
      reply_markup: miniAppKeyboard(config.publicUrl, {
        canAnnounce: canAnnounce(who.me) || actsAsAdmin(who.me, from.id),
        canAddOwnShifts: canAddOwnShifts(who.me),
      }),
    });
  }

  /** Monday of the week `offset` weeks from the current one, in team time. */
  function mondayForOffset(offset: number): { monday: string; today: string } {
    const today = teamNow(config.teamTz).date;
    return { monday: addDaysIso(mondayOfIso(today), offset * 7), today };
  }

  /**
   * The team's schedule as a picture. Visible to everyone in the menu: it's the
   * same data /api/team/schedule already gives any authorized worker, just on a
   * different medium — no need to open the mini app, it's already in the chat.
   *
   * Private chats only. Every other answer this bot gives concerns whoever
   * asked; this one is the whole team's roster, and it would go wherever the
   * update came from. Should the bot ever land in a group, one command would
   * publish the roster there. The guarantee belongs in the code, not in a
   * BotFather checkbox somebody can untick.
   */
  async function sendWeek(ctx: Context): Promise<void> {
    const from = ctx.from;
    if (!from) return;
    if (ctx.chat?.type !== "private") return;
    const who = acting(from.id);
    if (!who.ok) {
      await ctx.reply(who.text === "Ты не в системе" ? "Сначала отправь /start." : `${who.text}.`);
      return;
    }
    const { monday, today } = mondayForOffset(0);
    try {
      const image: WeekImage = buildWeekImage(db, monday, today, who.me.weekLegend);
      if (image.kind === "text") {
        await ctx.reply(image.text);
        return;
      }
      await ctx.replyWithPhoto(new InputFile(image.png, "week.png"), {
        caption: image.caption,
        reply_markup: weekKeyboard(0, who.me.weekLegend),
      });
    } catch (err) {
      // Covers a failed render and a failed send alike — either way the
      // person got nothing, and both deserve the same clear answer rather
      // than one of them failing silently into the log.
      console.error("week: send failed:", safeErrorMessage(err));
      await ctx.reply("Не смог нарисовать график, открой мини-апп.");
    }
  }

  bot.command("week", (ctx) => sendWeek(ctx));

  /**
   * Возврат нижней раскладки из любого состояния.
   *
   * Нужна из-за `force_reply`: Telegram подменяет им раскладку полем ответа, и
   * человек, не ответивший на вопрос багрепорта, остаётся без кнопок и без
   * способа их вернуть — `/start` для этого не выглядит и в меню команд подписан
   * про другое. Кому раскладка положена, решает `menuFor`, а не это место.
   *
   * Приватный чат только — как у `sendWeek`. Раскладка личная; в общем чате
   * «Кнопки на месте» было бы неправдой для всех, кроме того, кто написал.
   */
  bot.command("menu", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    const from = ctx.from;
    if (!from) return;
    const who = acting(from.id);
    if (!who.ok) {
      await ctx.reply(who.text === "Ты не в системе" ? "Сначала отправь /start." : `${who.text}.`);
      return;
    }
    await replyWithMenu(ctx, "Кнопки на месте 👇");
  });

  /**
   * «Сообщить о проблеме»: бот спрашивает, человек отвечает.
   *
   * `force_reply` — не украшение: Telegram сам ставит курсор в поле ввода и
   * привязывает ответ к этому сообщению, поэтому обычный путь не требует от
   * человека ничего, кроме «набрать и отправить». Окно в базе — страховка на
   * случай, когда он свернул чат и написал отдельным сообщением.
   *
   * Кнопка выхода едет ОТДЕЛЬНЫМ сообщением, а не в этом же `reply_markup`: у
   * Telegram это одно поле, а не два, и `force_reply` с `inline_keyboard` в нём
   * физически не уживаются (см. типы grammy —
   * `InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply`).
   *
   * И едет ПЕРВОЙ, до вопроса, а не после. Последним в чате должен остаться
   * вопрос: свайп-реплай на последнее сообщение — обычный жест, и именно он
   * обязан попасть на вопрос с `force_reply`. Уйди кнопка второй (и, значит,
   * последней), тот же реплай попал бы на неё — `replyToMessageId` не совпал бы
   * с `promptMessageId`, `shouldCapture` в bug-service.ts молча вернул бы
   * `false`, и жалоба потерялась бы без следа: ни записи в базе, ни ответа
   * человеку. `openBugPrompt` по-прежнему запоминает id ВОПРОСА — теперь это id
   * второго сообщения, а не первого.
   */
  async function startBugReport(ctx: Context): Promise<void> {
    const from = ctx.from;
    if (!from) return;
    const who = acting(from.id);
    if (!who.ok) {
      await ctx.reply(who.text === "Ты не в системе" ? "Сначала отправь /start." : `${who.text}.`);
      return;
    }
    await ctx.reply("Если передумал — вернись в меню.", {
      reply_markup: { inline_keyboard: [[{ text: "🏠 В меню", callback_data: "bug:cancel" }]] },
    });
    const sent = await ctx.reply(
      "Опиши, что не так — одним сообщением. Чем конкретнее, тем быстрее починим.",
      { reply_markup: { force_reply: true, input_field_placeholder: "Что сломалось?" } },
    );
    openBugPrompt(db, who.me.id, sent.message_id, new Date());
  }

  /**
   * Ссылка на сбор, присланная админом в личку.
   *
   * Стоит перед баг-репортом, потому что у багрепорта есть окно ожидания, а у
   * ссылки его нет: сообщение со ссылкой — единственный признак, по которому
   * бот вообще узнаёт, что от него чего-то хотят. Обратный порядок означал бы,
   * что ссылка не работает, пока окно открыто, и никто бы не понял почему.
   *
   * Но открытое окно эту ветку обходит, и это не мелочь: «не открывается
   * https://…/app/?screen=sick» — самая обычная жалоба, и без выхода ниже она
   * уезжала бы в чужой сбор, а команде через три дня уходило бы письмо со
   * ссылкой на экран мини-аппа. Вопрос «жалоба ли это» задаётся не своей
   * копией условия, а тем же `shouldCapture`, что и у `captureBugReport`: два
   * похожих условия здесь — это ровно тот случай, когда сообщение достаётся
   * обоим или никому.
   *
   * Возвращает `true`, если сообщение было ссылкой к сбору и обработано. Когда
   * ждущих сборов нет, ссылка достаётся `sendQr` ниже — с 2026-09-04 бот
   * отвечает на неё QR-кодом.
   *
   * Молчаливой привязки к единственному ждущему сбору больше нет, и это цена
   * QR-кода: ссылка от админа в две недели перед чьим-то днём рождения могла
   * быть и сбором, и просьбой нарисовать QR, и подменить ссылку сбора без
   * вопроса — худший из двух исходов. Один лишний тап раз в год дешевле.
   */
  async function captureCollectionLink(ctx: Context, text: string): Promise<boolean> {
    const from = ctx.from;
    if (!from) return false;
    const who = acting(from.id);
    if (!who.ok || !actsAsAdmin(who.me, from.id)) return false;

    const pending = getBugPending(db, who.me.id);
    if (pending && shouldCapture(pending, ctx.msg?.reply_to_message?.message_id, new Date())) return false;

    const url = extractUrl(text);
    if (!url) return false;

    const today = teamNow(config.teamTz).date;
    const candidates = linkCandidates(db, today, who.me.id);
    if (candidates.length === 0) return false;

    // Ноль ждущих — значит все со ссылками, и это замена: спрашиваем со всеми,
    // потому что молча подменить ссылку под чужим готовым сбором нельзя.
    const waiting = candidates.filter((c) => !c.hasUrl);
    await askWhichCollection(ctx, who.me.id, url, waiting.length > 0 ? waiting : candidates);
    return true;
  }

  /** Привязка и ответ. Общая для прямого случая и для выбора кнопкой. */
  async function bindLink(
    ctx: Context, adminEmployeeId: number, honoureeId: number, url: string, today: string,
  ): Promise<void> {
    const round = ensureBirthdayRound(db, honoureeId, today);
    if (!round) {
      await ctx.reply("Не нашёл, к какому дню рождения это привязать.");
      return;
    }
    const updated = attachLink(db, { round, url, asOf: today, actorEmployeeId: adminEmployeeId });
    const preview = previewCollection(db, updated);

    await ctx.reply(
      linkAcceptedMessage(
        preview.personName ?? "именинника", updated.autoSendOn, today,
        preview.recipients.length, preview.message,
      ),
      { reply_markup: autoSendKeyboard(updated.id) },
    );
    await notifyLinkReady(db, bot, updated, adminEmployeeId, today);
  }

  /**
   * Есть сборы — спрашиваем. Ссылка ждёт в окне, а не в `callback_data`.
   *
   * Последняя кнопка — выход из вопроса: ссылка может быть вовсе не про сбор,
   * и без неё админу в эти две недели QR-код был бы недоступен.
   */
  async function askWhichCollection(
    ctx: Context, adminEmployeeId: number, url: string, candidates: LinkCandidate[],
  ): Promise<void> {
    setLinkPending(db, adminEmployeeId, url);
    await ctx.reply("К какому сбору эта ссылка?", {
      reply_markup: {
        inline_keyboard: [
          ...candidates.map((c) => [{
            text: c.hasUrl ? `${c.displayName} · заменить ссылку` : c.displayName,
            callback_data: `collection:link:${c.employeeId}`,
          }]),
          [{ text: "Просто QR-код", callback_data: "collection:qr" }],
        ],
      },
    });
  }

  /**
   * QR-код по ссылке из сообщения. Последняя ветка текстового обработчика:
   * всё, что могло забрать сообщение себе (кнопки, сбор, жалоба), уже
   * отказалось. Ошибку рендера не глотаем: `/week` тоже не глотает, а тихое
   * молчание на ссылку выглядело бы как «бот сломался».
   */
  async function sendQr(ctx: Context, url: string): Promise<void> {
    const from = ctx.from;
    if (!from) return;
    if (!acting(from.id).ok) return;
    const image = await buildQrImage(url);
    if (image.kind === "text") {
      await ctx.reply(image.text);
      return;
    }
    await ctx.replyWithPhoto(new InputFile(image.png, "qr.png"), { caption: image.caption });
  }

  /** Текст, пришедший после нажатия кнопки. Вызывается последним — метки кнопок
   *  разбираются раньше и сюда не доходят. */
  async function captureBugReport(ctx: Context, text: string): Promise<boolean> {
    const from = ctx.from;
    if (!from) return false;
    const who = acting(from.id);
    if (!who.ok) return false;
    const pending = getBugPending(db, who.me.id);
    if (!pending) return false;
    if (!shouldCapture(pending, ctx.msg?.reply_to_message?.message_id, new Date())) return false;

    const res = submitBugReport(db, who.me.id, text, new Date());
    if (!res.ok) {
      await ctx.reply(res.reason);
      return true;
    }
    // Аудит уже записал `submitBugReport` — второй записи здесь не нужно,
    // иначе одна жалоба легла бы в журнал дважды. Сверено с bug-service.ts.
    clearBugPending(db, who.me.id);
    // Через `replyWithMenu`, а не голым `ctx.reply`: вопрос был задан с
    // `force_reply`, и раскладку у человека Telegram на это время убрал. Обычный
    // путь «нажал → написал → отправил» обязан возвращать её сам, без лишнего тапа.
    await replyWithMenu(ctx, "Записал, спасибо 🙏 Разберёмся.");
    await notifyBugReport(bot, db, res.report.id, `🐞 ${who.me.displayName}: ${res.report.text}`);
    return true;
  }

  /**
   * Нажатая кнопка постоянной клавиатуры. Telegram присылает её обычным
   * текстовым сообщением, поэтому единственный ключ — точное совпадение метки.
   * Кнопка «Мои смены» сюда не попадает: она `web_app`, её нажатие открывает
   * мини-апп и боту не шлёт ничего.
   *
   * Регистрируется после всех `bot.command(...)` намеренно: grammy передаёт
   * управление дальше по цепочке только если предыдущий обработчик об этом
   * попросил, а команды не просят — значит `/week` сюда не долетит и обработан
   * дважды не будет.
   *
   * Приватные чаты только. Не для симметрии: без этой проверки кнопка «График»
   * стала бы обходом защиты `sendWeek`, которая существует ровно для того,
   * чтобы роспись всей команды не публиковалась в группу.
   *
   * На всё остальное, кроме ссылки, бот молчит, как молчал до этой клавиатуры.
   * Отвечать на произвольный текст его никто не просил; на ссылку с 2026-09-04
   * просили — QR-кодом, см. `sendQr`.
   */
  /**
   * `/instruction` — приложить дежурным файл с инструкцией.
   *
   * Второй путь рядом с загрузкой из вебки, а не единственный: файл, который уже
   * лежит в телефоне, быстрее переслать боту, чем открывать консоль. Из браузера
   * он с 2026-08-24 кладётся тоже — `POST /api/admin/checklists/:id/doc`.
   *
   * Присланный сюда файл никуда не скачивается: остаётся `file_id`, и бот
   * пересылает документ по нему. Загруженный из вебки лежит на диске, а его
   * `file_id` появляется кэшем после первой рассылки (`runChecklistTick`).
   *
   * Первым делом спрашивает, К КАКОМУ чек-листу: их несколько, у дежурного с
   * семи и у дежурного с восьми инструкции разные, и «приложить вообще» — это
   * вопрос без ответа.
   */
  async function startInstructionUpload(ctx: Context): Promise<void> {
    const from = ctx.from;
    if (!from) return;
    const who = acting(from.id);
    if (!who.ok) {
      await ctx.reply(who.text === "Ты не в системе" ? "Сначала отправь /start." : `${who.text}.`);
      return;
    }
    if (!actsAsAdmin(who.me, from.id)) {
      await ctx.reply("Инструкцию дежурным прикладывают админы.");
      return;
    }

    const lists = listChecklists(db);
    if (lists.length === 0) {
      await ctx.reply("Сначала заведи чек-лист в консоли — на экране «Чек-листы». Тогда будет к чему прикладывать.");
      return;
    }

    await ctx.reply("К какому чек-листу приложить инструкцию?", {
      reply_markup: {
        inline_keyboard: lists.map((list) => [
          {
            text: list.docFileId ? `${list.name} · заменить файл` : list.name,
            callback_data: `checklist:doc:${list.id}`,
          },
        ]),
      },
    });
  }

  bot.command("instruction", (ctx) => startInstructionUpload(ctx));

  bot.callbackQuery(/^checklist:doc:(\d+)$/, async (ctx) => {
    const who = acting(ctx.from.id);
    if (!who.ok || !actsAsAdmin(who.me, ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Только для админов" });
      return;
    }
    const checklistId = Number(ctx.match[1]);
    const list = getChecklist(db, checklistId);
    if (!list) {
      await ctx.answerCallbackQuery({ text: "Чек-лист удалён" });
      return;
    }
    startDocPending(db, who.me.id, checklistId);
    await ctx.answerCallbackQuery();
    await ctx.reply(
      list.docFileId
        ? `«${list.name}»: сейчас приложено «${list.docName ?? "файл"}».\nПришли новый файл одним сообщением — он заменит прежний.`
        : `«${list.name}»: пришли файл одним сообщением — он будет уходить дежурным вместе со списком.`,
      list.docFileId
        ? { reply_markup: { inline_keyboard: [[{ text: "🗑 Убрать файл", callback_data: `checklist:docclear:${list.id}` }]] } }
        : undefined,
    );
  });

  /**
   * «Собрали, закрыть» прямо из напоминания.
   *
   * Кнопка живёт в том же сообщении, которым бот попросил дожать сбор: ответ на
   * просьбу — одно движение, а не «открой мини-апп, найди сбор, раскрой карточку».
   * Поля журнала — те же, что пишет закрытие из вебки: журнал не должен читаться
   * по-разному в зависимости от того, откуда нажали.
   */
  bot.callbackQuery(/^collection:close:(\d+)$/, async (ctx) => {
    const who = acting(ctx.from.id);
    if (!who.ok || !actsAsAdmin(who.me, ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Закрывают сборы админы" });
      return;
    }
    const id = Number(ctx.match[1]);
    const collection = getCollection(db, id);
    if (!collection) {
      await ctx.answerCallbackQuery({ text: "Сбор удалён" });
      return;
    }
    if (collection.closedAt != null) {
      await ctx.answerCallbackQuery({ text: "Сбор уже закрыт" });
      return;
    }
    const updated = setCollectionClosed(db, id, true, new Date());
    const title = previewCollection(db, updated ?? collection).title;
    recordAudit(db, "collection_closed", who.me.id, {
      collectionId: collection.id,
      employeeId: collection.employeeId,
      title,
      closed: true,
    });
    await ctx.answerCallbackQuery({ text: "Закрыл" });
    await ctx.reply(`Сбор «${title}» закрыт.`);
  });

  /**
   * Выбор сбора для присланной ссылки.
   *
   * Ссылка лежит в окне ожидания, а не в `callback_data`: там 64 байта, и
   * ссылка на сбор в них не помещается.
   */
  bot.callbackQuery(/^collection:link:(\d+)$/, async (ctx) => {
    const who = acting(ctx.from.id);
    if (!who.ok || !actsAsAdmin(who.me, ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Сборы ведут админы" });
      return;
    }
    const url = linkPendingFor(db, who.me.id);
    if (!url) {
      await ctx.answerCallbackQuery();
      await ctx.reply("Не помню, какую ссылку ты присылал. Пришли ссылку ещё раз.");
      return;
    }
    clearLinkPending(db, who.me.id);
    await ctx.answerCallbackQuery();
    await bindLink(ctx, who.me.id, Number(ctx.match[1]), url, teamNow(config.teamTz).date);
  });

  /** «Просто QR-код» под вопросом про сбор: ссылка та же, что ждёт в окне. */
  bot.callbackQuery(/^collection:qr$/, async (ctx) => {
    const who = acting(ctx.from.id);
    if (!who.ok) {
      await ctx.answerCallbackQuery({ text: `${who.text}.` });
      return;
    }
    const url = linkPendingFor(db, who.me.id);
    if (!url) {
      await ctx.answerCallbackQuery();
      await ctx.reply("Не помню, какую ссылку ты присылал. Пришли ссылку ещё раз.");
      return;
    }
    clearLinkPending(db, who.me.id);
    await ctx.answerCallbackQuery();
    await sendQr(ctx, url);
  });

  /**
   * Готовые опережения для кнопки «другой день».
   *
   * Ввод даты текстом — ещё одно окно ожидания и ещё один парсер ради случая
   * раз в год; кому нужно точнее, у того в мини-аппе календарь.
   */
  const AUTO_SEND_LEADS: { label: string; days: number }[] = [
    { label: "за 5 дней", days: 5 },
    { label: "за 3 дня", days: 3 },
    { label: "за 1 день", days: 1 },
    { label: "в день ДР", days: 0 },
  ];

  bot.callbackQuery(/^collection:autoday:(\d+)$/, async (ctx) => {
    const who = acting(ctx.from.id);
    if (!who.ok || !actsAsAdmin(who.me, ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Сборы ведут админы" });
      return;
    }
    const id = Number(ctx.match[1]);
    await ctx.answerCallbackQuery();
    await ctx.reply("За сколько дней разослать?", {
      reply_markup: {
        inline_keyboard: AUTO_SEND_LEADS.map((lead) => [
          { text: lead.label, callback_data: `collection:autoday:${id}:${lead.days}` },
        ]),
      },
    });
  });

  bot.callbackQuery(/^collection:autoday:(\d+):(\d+)$/, async (ctx) => {
    const who = acting(ctx.from.id);
    if (!who.ok || !actsAsAdmin(who.me, ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Сборы ведут админы" });
      return;
    }
    const collection = getCollection(db, Number(ctx.match[1]));
    if (!collection?.celebratedOn) {
      await ctx.answerCallbackQuery({ text: "Сбор не найден" });
      return;
    }
    const today = teamNow(config.teamTz).date;
    const autoSendOn = autoSendDateFor(collection.celebratedOn, today, Number(ctx.match[2]));
    updateCollection(db, collection.id, { autoSendOn });
    await ctx.answerCallbackQuery({ text: "Переставил" });
    await ctx.reply(autoSendLabel(autoSendOn, today) ?? "Автоотправка выключена.");
  });

  bot.callbackQuery(/^collection:autooff:(\d+)$/, async (ctx) => {
    const who = acting(ctx.from.id);
    if (!who.ok || !actsAsAdmin(who.me, ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Сборы ведут админы" });
      return;
    }
    const collection = getCollection(db, Number(ctx.match[1]));
    if (!collection) {
      await ctx.answerCallbackQuery({ text: "Сбор не найден" });
      return;
    }
    // Гасим только автоотправку. Ссылку не трогаем: отвязывать её заодно —
    // значит наказывать за нажатие кнопки «подожди».
    updateCollection(db, collection.id, { autoSendOn: null });
    await ctx.answerCallbackQuery({ text: "Не разошлю" });
    await ctx.reply("Не разошлю сам. Сбор остался в «Днях рождения» — разошлёшь, когда решишь.");
  });

  bot.callbackQuery(/^checklist:docclear:(\d+)$/, async (ctx) => {
    const who = acting(ctx.from.id);
    if (!who.ok || !actsAsAdmin(who.me, ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Только для админов" });
      return;
    }
    const checklistId = Number(ctx.match[1]);
    const list = getChecklist(db, checklistId);
    if (!list) {
      await ctx.answerCallbackQuery({ text: "Чек-лист удалён" });
      return;
    }
    updateChecklist(db, checklistId, { docFileId: null, docName: null });
    clearDocPending(db);
    recordAudit(db, "checklist_doc_changed", who.me.id, { fileName: list.docName, attached: false, checklistName: list.name });
    await ctx.answerCallbackQuery({ text: "Убрал" });
    await ctx.reply(`«${list.name}»: инструкция снята — дежурным она больше не уходит.`);
  });

  /**
   * Файл, присланный в открытое окно ожидания, становится инструкцией.
   *
   * Окно, а не «любой документ от админа»: админы шлют боту файлы и по другим
   * поводам, и молча превращать чужой PDF в инструкцию для всей смены нельзя.
   */
  bot.on("message:document", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    const who = acting(ctx.from?.id ?? 0);
    if (!who.ok || !actsAsAdmin(who.me, ctx.from!.id)) return;
    const pending = docPendingFor(db, who.me.id, new Date());
    if (pending == null) return;
    const list = getChecklist(db, pending);
    if (!list) {
      clearDocPending(db);
      return;
    }

    const doc = ctx.msg.document;
    updateChecklist(db, pending, { docFileId: doc.file_id, docName: doc.file_name ?? "Инструкция" });
    clearDocPending(db);
    recordAudit(db, "checklist_doc_changed", who.me.id, {
      fileName: doc.file_name ?? null,
      attached: true,
      checklistName: list.name,
    });
    await ctx.reply(`Приложил «${doc.file_name ?? "файл"}» к чек-листу «${list.name}». Дежурные получат его вместе со списком.`);
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    const text = ctx.msg.text;
    if (text === BTN_WEEK) await sendWeek(ctx);
    else if (text === BTN_MY_SHIFTS) await sendMiniApp(ctx);
    else if (text === BTN_REMINDERS) await sendReminders(ctx);
    else if (text === BTN_ADMIN) await sendAdminLink(ctx);
    else if (text === BTN_BUG) await startBugReport(ctx);
    // Всё, что выше, — метки кнопок, и они всегда кнопки. Дальше по порядку:
    // сбор, жалоба, и только потом QR — ссылка внутри жалобы остаётся жалобой.
    else if (await captureCollectionLink(ctx, text)) return;
    else if (await captureBugReport(ctx, text)) return;
    else {
      const url = extractUrl(text);
      if (url) await sendQr(ctx, url);
    }
  });

  /**
   * Paging through weeks. Unlike the cosmetic edits elsewhere in this file,
   * redrawing the picture is the useful action itself, so its failure is
   * reported to the person as a toast, not just to the log.
   */
  /**
   * «🔤 Скрыть/Показать расшифровку» — личная настройка, переключаемая там, где
   * виден результат. Картинка перерисовывается на месте, как при листании.
   */
  bot.callbackQuery(/^week:legend:(-?\d+)$/, async (ctx) => {
    const who = acting(ctx.from.id);
    if (!who.ok) {
      await ctx.answerCallbackQuery({ text: who.text });
      return;
    }
    // Тот же довод, что у листания ниже: сообщение живёт вечно, а чат мог быть
    // групповым — команду нельзя опубликовать туда одним нажатием.
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery({ text: "Только в личном чате" });
      return;
    }
    const offset = Number(ctx.match[1]);
    if (Math.abs(offset) > WEEK_OFFSET_LIMIT) {
      await ctx.answerCallbackQuery({ text: "Дальше не листаю" });
      return;
    }
    const showLegend = !who.me.weekLegend;
    setWeekLegend(db, who.me.id, showLegend);
    const { monday, today } = mondayForOffset(offset);
    let answered = false;
    try {
      const image: WeekImage = buildWeekImage(db, monday, today, showLegend);
      if (image.kind === "text") {
        answered = true;
        await ctx.answerCallbackQuery({ text: image.text });
        return;
      }
      await ctx.editMessageMedia(
        { type: "photo", media: new InputFile(image.png, "week.png"), caption: image.caption },
        { reply_markup: weekKeyboard(offset, showLegend) },
      );
      answered = true;
      await ctx.answerCallbackQuery({ text: showLegend ? "Показываю расшифровку" : "Убрал расшифровку" });
    } catch (err) {
      console.error("week: legend redraw failed:", safeErrorMessage(err));
      if (!answered) await ctx.answerCallbackQuery({ text: "Не получилось — пришли /week заново" });
    }
  });

  // «Обновить» — то же листание с нулевым шагом: картинка перерисовывается по
  // тем же правилам, отличается только тост. Молчаливый успех здесь не годится:
  // если в графике ничего не изменилось, человек не увидел бы, что нажатие
  // вообще сработало.
  bot.callbackQuery(/^week:(refresh:)?(-?\d+)$/, async (ctx) => {
    const isRefresh = ctx.match[1] !== undefined;
    const offset = Number(ctx.match[2]);
    const who = acting(ctx.from.id);
    if (!who.ok) {
      await ctx.answerCallbackQuery({ text: who.text });
      return;
    }
    // Mirrors /week's own guard above. `ctx.chat` here comes from the message
    // the tapped button is attached to, not from whoever tapped it — so this
    // is exactly the check that closes the hole /week's guard alone leaves
    // open: a photo a group received before that guard existed would, without
    // this, still redraw the team's roster into the group on every tap.
    // `?.` covers the (documented but rare) case where Telegram hands back a
    // callback whose original message is gone — that's never a private chat.
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery({ text: "Только в личном чате" });
      return;
    }
    // The out-of-range button is never drawn, but the message lives forever —
    // the data can come from anything, so the limit is checked here too.
    // (`!Number.isInteger(offset)` would be redundant: the regex only ever
    // hands `Number()` a run of digits, and the sole non-integer it can
    // produce that way is ±Infinity — already caught by the `Math.abs` check.)
    if (Math.abs(offset) > WEEK_OFFSET_LIMIT) {
      await ctx.answerCallbackQuery({ text: "Дальше не листаю" });
      return;
    }
    const { monday, today } = mondayForOffset(offset);
    // True once the picture on screen has actually changed — set before the
    // closing answerCallbackQuery, not after it. If that closing call is what
    // throws, retrying it in the catch below would be a second live call for
    // the same tap: Telegram either rejects it (the exception would then
    // escape uncaught) or, worse, delivers it — flashing "Не получилось" over
    // a picture that in fact just updated. Once the redraw itself is done,
    // failing to also clear the button's spinner isn't worth either risk.
    let answered = false;
    try {
      const image: WeekImage = buildWeekImage(db, monday, today, who.me.weekLegend);
      if (image.kind === "text") {
        // Set before the call, not after: here the answer *is* the useful
        // action, so retrying it in the catch would be a second live answer for
        // one tap — the very hole the flag exists to close.
        answered = true;
        await ctx.answerCallbackQuery({ text: image.text });
        return;
      }
      await ctx.editMessageMedia(
        { type: "photo", media: new InputFile(image.png, "week.png"), caption: image.caption },
        { reply_markup: weekKeyboard(offset, who.me.weekLegend) },
      );
      answered = true;
      await ctx.answerCallbackQuery(isRefresh ? { text: "Обновил" } : undefined);
    } catch (err) {
      console.error("week: redraw failed:", safeErrorMessage(err));
      // Also what a person sees once the message crosses Telegram's 48-hour
      // edit window (see weekKeyboard's comment) — the toast has to point
      // somewhere that still works, so it names the way back in.
      if (!answered) await ctx.answerCallbackQuery({ text: "Не получилось — пришли /week заново" });
    }
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
      await ctx.reply(
        "Напоминания о сменах выключены. Чек-лист дежурного будет приходить всё равно — это рабочая инструкция на смену. " +
          "Вернуть напоминания — командой /notifications или в мини-аппе, «Мои смены».",
      );
    }
    // Only the buttons are rewritten: the reminder itself is still the useful part
    // of the message, and replacing it would delete tomorrow's shift time.
    await safeEdit(() => ctx.editMessageReplyMarkup({ reply_markup: remindersKeyboard(enabled) }));
  });

  /**
   * «Не писать мне про это» под админским уведомлением.
   *
   * Как и у напоминаний, вид берётся из callback-данных, а человек — из того,
   * кто нажал: чужие уведомления выключить нечем. Проверка на админа нужна
   * отдельно — кнопка живёт в чате вечно, а админа могли разжаловать.
   */
  bot.callbackQuery(/^notice:mute:([a-z_]+)$/, async (ctx) => {
    const kind = ADMIN_NOTICE_KINDS.find((k) => k === ctx.match[1]);
    const who = acting(ctx.from.id);
    if (!who.ok) {
      await ctx.answerCallbackQuery({ text: who.text });
      return;
    }
    if (!kind) {
      await ctx.answerCallbackQuery({ text: "Такого вида уведомлений больше нет" });
      return;
    }
    if (!actsAsAdmin(who.me, ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Это настройка администратора" });
      return;
    }
    setNoticeMuted(db, who.me.id, kind, true);
    await ctx.answerCallbackQuery({ text: "Больше не буду 🔕" });
    // Существенное — до косметики: человек должен знать, где вернуть обратно.
    await ctx.reply(
      `«${ADMIN_NOTICE_LABELS[kind].title}» больше не пишу. Вернуть — в мини-аппе, «Админ» → «Настройки».`,
    );
    // Снимается только кнопка: текст уведомления по-прежнему нужен человеку.
    await safeEdit(() => ctx.editMessageReplyMarkup());
  });

  /**
   * «Разобрал» под багрепортом.
   *
   * Проверка на админа — отдельно от `acting`, как и у `notice:mute` выше:
   * кнопка живёт в чате Telegram вечно, а админа могли разжаловать.
   */
  bot.callbackQuery(/^bug:resolve:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const who = acting(ctx.from.id);
    if (!who.ok) {
      await ctx.answerCallbackQuery({ text: who.text });
      return;
    }
    if (!actsAsAdmin(who.me, ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Это может только админ" });
      return;
    }
    // `resolveBugReport` уже пишет аудит сама (сверено с bug-service.ts) —
    // второй вызов здесь задвоил бы запись.
    const updated = resolveBugReport(db, id, who.me.id, true, new Date());
    if (!updated) {
      await ctx.answerCallbackQuery({ text: "Сообщение не найдено" });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Отметил ✅" });
    await safeEdit(() => ctx.editMessageReplyMarkup());
  });

  /**
   * «🏠 В меню» под вопросом багрепорта.
   *
   * Гасит окно ожидания — без этого следующее написанное человеком сообщение,
   * адресованное совсем не боту, уехало бы админам багрепортом.
   *
   * Раскладка возвращается НОВЫМ сообщением, а не правкой этого: постоянная
   * клавиатура едет только с отправкой, отредактировать её в уже отправленное
   * Telegram не даёт. Правкой снимается лишь сама inline-кнопка, чтобы её нельзя
   * было нажать второй раз и получить второе «кнопки на месте».
   */
  bot.callbackQuery(/^bug:cancel$/, async (ctx) => {
    const who = acting(ctx.from.id);
    if (!who.ok) {
      await ctx.answerCallbackQuery({ text: who.text });
      return;
    }
    clearBugPending(db, who.me.id);
    await ctx.answerCallbackQuery({ text: "Ок, не буду ждать" });
    await safeEdit(() => ctx.editMessageReplyMarkup());
    // `replyWithMenu`, а не руками собранный `menuFor(ctx.from.id, ...)`: в
    // callback-контексте `ctx.from` есть всегда, так что замена побайтово
    // эквивалентна, а хелпер уже есть рядом и делает ровно это.
    await replyWithMenu(ctx, "Кнопки на месте 👇");
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
      const payload = swapAuditPayload(db, res.request);
      await notifyUser(bot, initiatorTg, action === "accept" ? swapAcceptedText(payload) : swapDeclinedText(payload));
    }
    if (action === "accept") {
      // Тот же хвост про пул, что и на маршруте мини-аппа: без него два входа
      // расскажут админам разное про один и тот же обмен.
      await notifyAdmins(
        bot,
        db,
        "swaps",
        swapAcceptedAdminText(
          swapAuditPayload(db, res.request),
          outsidePoolFacts(db, res.request).map(dutyNoticeForAdmins),
        ),
      );
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
    const res = expressInterest(db, slotId, me.id, teamNow(config.teamTz).date);
    if (!res.ok) {
      // This button is months old by the time some of these fire — «Слот не найден»
      // for every refusal told people the wrong thing about a slot that exists.
      const text =
        res.reason === "not_open" ? "Уже разобрали"
        : res.reason === "slot_passed" ? "Эта смена уже прошла"
        : res.reason === "not_active" ? "Ты в архиве — напиши админу"
        : "Слот не найден";
      await ctx.answerCallbackQuery({ text });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Записал 🙋" });
    // drop the button — interest recorded. Через safeEdit, как и три других
    // косметических edit'а в файле: без него сбой этого вызова долетал бы до
    // bot.catch и логировался общей строкой «bot handler error», а не понятной
    // «cosmetic edit failed» — процесс не падает в любом случае, разница только
    // в том, что написано в логе.
    await safeEdit(() => ctx.editMessageReplyMarkup());
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
      "weekend",
      action === "confirm" ? weekendConfirmedAdminText(me.displayName, slotLine) : weekendDeclinedAdminText(me.displayName, slotLine),
    );

    // Only the buttons go stale — the offer text (which slot, which hours) is
    // still what the person needs, so leave it and just drop Беру/Не смогу.
    await safeEdit(() => ctx.editMessageReplyMarkup());
  });

  /**
   * «Беру» / «Не могу» on a shift somebody could not work.
   *
   * The whole decision lives in `handover-service`, which the mini app has no
   * route into: this button is the ONLY entrance to taking a handover. That is
   * deliberate — the answer belongs in the chat where the question was asked,
   * and a second entrance would be a second place for the rules to drift.
   *
   * `acting` first, like every other button here: these are a second entrance to
   * the data, and the one time they were not guarded (cf33022) an archived person
   * could still record themselves onto the schedule.
   */
  bot.callbackQuery(/^handover:(take|decline):(\d+)$/, async (ctx) => {
    const action = ctx.match[1] as "take" | "decline";
    const handoverId = Number(ctx.match[2]);
    const who = acting(ctx.from.id);
    if (!who.ok) {
      await ctx.answerCallbackQuery({ text: who.text });
      return;
    }
    const deps = { db, config, messenger: createHandoverMessenger(bot, db) };
    const res =
      action === "take"
        ? await takeHandover(deps, handoverId, who.me.id)
        : await declineHandover(deps, handoverId, who.me.id);
    if (!res.ok) {
      // The service writes its refusals in Russian a person can read — «Уже
      // забрали», «У тебя в это время уже стоит своя смена» — so they go straight
      // through. There is no reason code to translate here, unlike swaps.
      await ctx.answerCallbackQuery({ text: res.reason });
      return;
    }
    await ctx.answerCallbackQuery({ text: action === "take" ? "Готово ✅" : "Понял, спрошу других" });

    // Only the buttons go stale — which shift it was is still worth reading, so
    // the text stays. Through `safeEdit`, like every cosmetic edit in this file:
    // a failure here must not reach `bot.catch` as an unexplained handler error.
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
