import { Bot, GrammyError, InlineKeyboard } from "grammy";
import type { Db } from "../db/client";
import { listAdmins, listActive, getEmployeeById } from "../repo/employees";
import { isNoticeMuted } from "../repo/notice-prefs";
import { safeErrorMessage } from "../util/safe-error";
import type { SwapAuditPayload } from "../util/message-lines";
import type { OutsidePoolFact } from "../swap/duty-notice";
import { takesPartInAssignment, type AdminNoticeKind } from "@planer/shared";

// --- Swap text builders ------------------------------------------------------
//
// Hand-copied into both `bot.ts` (the Telegram-button path) and `app.ts` (the
// mini-app path) used to be how these read — two literal strings that happened
// to agree today and had nothing keeping them that way. Both call sites import
// these instead, so a wording change can never land on only one path.

/**
 * Sent to a swap's original initiator once the counterparty accepts it.
 *
 * Names both shifts, like the admin broadcast below has always done. Somebody
 * with two proposals out at once read «Твой обмен приняли ✅ Смены поменялись»
 * and still didn't know which shift they were working tomorrow.
 */
export function swapAcceptedText(p: SwapAuditPayload): string {
  return `Твой обмен с ${p.toName} приняли ✅ Ты отдал(а) ${p.fromShift}, взамен работаешь ${p.toShift}.`;
}

/** Sent to a swap's original initiator once the counterparty declines it. Named
 *  for the same reason as the accepted one — «Твой обмен отклонили» is which? */
export function swapDeclinedText(p: SwapAuditPayload): string {
  return `${p.toName} отклонил(а) твой обмен: ${p.fromShift} ↔ ${p.toShift}.`;
}

/**
 * Само предложение обмена — сообщение, на котором висят «Принять/Отклонить».
 *
 * Жило литералом в `app.ts`; переехало сюда по причине из шапки этого файла.
 * `notices` — то, что человек обязан прочитать ДО нажатия (см. `duty-notice.ts`):
 * отдельным абзацем, а не в конце строки, потому что строка с двумя записями
 * графика длинная, и приписанный к ней хвост читается как её продолжение.
 */
export function swapProposalText(p: SwapAuditPayload, notices: readonly string[] = [], message?: string | null): string {
  const head = `«${p.fromName} предлагает обмен: отдаёт ${p.fromShift}, хочет твою ${p.toShift}»`;
  // Просьба автора — между шапкой и пометками: пометка про пул должна остаться
  // последним, что человек читает перед «Принять».
  const note = message?.trim() ? `💬 «${message.trim()}»` : null;
  return [head, note, notices.length ? notices.join("\n") : null].filter(Boolean).join("\n\n");
}

/** Второй стороне, когда автор сам отозвал заявку. Голое «Заявку отменили» не
 *  говорило, какую — а у человека их бывает несколько сразу. */
export function swapCancelledText(p: SwapAuditPayload): string {
  return `${p.fromName} отменил(а) заявку на обмен: ${p.fromShift} ↔ ${p.toShift}.`;
}

/** Admin broadcast once a swap actually goes through. Named and dated, so with
 *  30 people on the team an admin can tell which swap this was. Не «обмен
 *  сменами»: с 2026-08-10 в паре может стоять дежурство, и старая формулировка
 *  рядом с ним просто врала. */
export function swapAcceptedAdminText(p: SwapAuditPayload, notices: readonly string[] = []): string {
  const head = `Обмен состоялся: ${p.fromName} (${p.fromShift}) ↔ ${p.toName} (${p.toShift}).`;
  return notices.length === 0 ? head : `${head} ${notices.join(" ")}`;
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

/** Why a pending swap stopped being possible without its initiator doing
 *  anything — an admin removed the entry under it, replaced the whole month, or
 *  the shift changed hands so the trade no longer adds up. */
export type SwapExpiryCause = "entry_deleted" | "roster_reimported" | "shift_changed" | "date_passed";

/**
 * Sent to *both* sides of a pending swap an admin's edit just invalidated —
 * or, for `date_passed`, only to the initiator (see `swap-expiry-tick.ts`):
 * the shift has already happened, so the counterparty has nothing left to
 * act on and no answer to give — there's nothing to tell them.
 *
 * Goes out to the initiator too, and that's the point: they proposed it and did
 * nothing since, so without this the request just turns «Истекло» in the archive
 * with no cause attached. Names both shifts because the row itself no longer can
 * — the pointer at the vanished entry is null from here on. One builder, one
 * clause that varies, because two near-identical strings are how these drift.
 */
export function swapExpiredText(p: SwapAuditPayload, cause: SwapExpiryCause): string {
  if (cause === "date_passed") {
    return `Заявка на обмен закрылась: смена уже прошла, а ответа не было. Было: ${p.fromShift} ↔ ${p.toShift}.`;
  }
  const why =
    cause === "entry_deleted" ? "смену удалили из расписания"
    : cause === "roster_reimported" ? "график за этот период загрузили заново"
    : "смена изменилась, и обмен больше невозможен";
  return `Обмен неактуален: ${why}. Было: ${p.fromName} (${p.fromShift}) ↔ ${p.toName} (${p.toShift}).`;
}

/**
 * Тому, кто вот-вот возьмёт чужое дежурство и не входит в его пул.
 *
 * Не запрет: пул — правило автораздачи, а не право (его решение от 2026-08-10).
 * Но человек стоит в одном нажатии от Поклонки, и прочитать это он должен ДО
 * нажатия, а не узнать потом из графика.
 */
export function dutyNoticeForReceiver(f: OutsidePoolFact): string {
  return `⚠️ Ты берёшь дежурство: ${f.dutyName}. Ты не в списке тех, кто обычно на него выходит — если это ошибка, спроси у админа.`;
}

/** То же самое админам: они читают про третьего человека, поэтому по имени. */
export function dutyNoticeForAdmins(f: OutsidePoolFact): string {
  return `⚠️ ${f.receiverName} не в списке тех, кто обычно выходит на «${f.dutyName}».`;
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

/**
 * `keyboard` — необязательный четвёртый параметр, а не новая функция: у
 * `notifyUser` уже полтора десятка вызывающих без клавиатуры, и им незачем
 * знать, что где-то ещё она есть. Опущенный аргумент — это `undefined`, то
 * есть в точности прежнее поведение.
 */
export async function notifyUser(bot: Bot, telegramUserId: number, text: string, keyboard?: InlineKeyboard): Promise<boolean> {
  try {
    await bot.api.sendMessage(telegramUserId, text, keyboard ? { reply_markup: keyboard } : undefined);
    return true;
  } catch (err) {
    console.error(`notifyUser: failed for ${telegramUserId}:`, safeErrorMessage(err));
    return false;
  }
}

/**
 * Кнопка «выключить это письмо» — тот же билдер, которым `notifyAdmins`
 * собирает свою клавиатуру, вынесенный наружу для писем, которые уходят не
 * через неё (см. `birthday-notice.ts`: у них свой список адресатов —
 * `adminRecipients`, а не все админы, — и свой цикл рассылки). Один билдер,
 * чтобы строка колбэка `notice:mute:<kind>` не расходилась между местами,
 * которые её собирают.
 */
export function noticeMuteKeyboard(kind: AdminNoticeKind): InlineKeyboard {
  return new InlineKeyboard().text("🔕 Не писать мне про это", `notice:mute:${kind}`);
}

/**
 * «Я перевёл» под письмом сбора — и та же кнопка после нажатия, уже без дела.
 *
 * Письмо со ссылкой человек читает в боте и по ссылке переводит из бота, значит
 * и отметиться должен там же, а не в мини-аппе, куда за этим надо идти. Один
 * билдер на три рассылки (ручная, дожим, автоотправка), чтобы строка колбэка
 * `collection:paid:<id>` не разошлась между ними.
 *
 * Бот не знает, переходил ли человек по ссылке: кнопка висит под письмом сразу.
 */
export function collectionPaidKeyboard(collectionId: number): InlineKeyboard {
  return new InlineKeyboard().text("✅ Я перевёл", `collection:paid:${collectionId}`);
}

/**
 * Та же кнопка после нажатия. Колбэк тот же, а не «пустой»: повторный тап
 * отвечает словами, где снять галочку, вместо молчания. Снять её здесь нельзя
 * намеренно — второй тап по старому письму чаще случайный, чем осознанный.
 */
export function collectionPaidDoneKeyboard(collectionId: number): InlineKeyboard {
  return new InlineKeyboard().text("✓ Вы отметились", `collection:paid:${collectionId}`);
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
export async function notifyReminder(bot: Bot, telegramUserId: number, text: string, appUrl?: string): Promise<SendOutcome> {
  const kb = new InlineKeyboard();
  // Вечер накануне — момент, когда человек понимает, что выйти не может. Под
  // рукой должно быть действие, а не только «замолчи». Инлайн-`web_app`, не
  // клавиатурная: только она несёт подпись initData (см. `keyboard.ts`).
  if (appUrl) kb.webApp("📋 Мои смены", appUrl).row();
  kb.text("🔕 Отключить напоминания", "reminders:off");
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

/**
 * Broadcasts a new vacant weekend slot to every active worker, each with a
 * "🙋 Хочу" button routed to `weekend:interest:<slotId>`.
 *
 * Reports how far it got, because only people who have linked Telegram can be
 * reached at all: with a third of the team linked, «опубликовано» silently means
 * «спросил треть». Same `delivered`/`intended` pair the birthday broadcast returns.
 */
export async function notifyVacantSlot(
  bot: Bot,
  db: Db,
  slotId: number,
  text: string,
): Promise<{ delivered: number; intended: number }> {
  const kb = new InlineKeyboard().text("🙋 Хочу", `weekend:interest:${slotId}`);
  // A call for weekend volunteers is an assignment offer, so people an admin took
  // out of assignments are out of this too. Filtered before `intended` is measured,
  // or «дошло до N из M» would count people we deliberately never wrote to.
  const team = listActive(db).filter((employee) => takesPartInAssignment(employee));
  let delivered = 0;
  for (const e of team) {
    if (e.telegramUserId == null) continue;
    try {
      await bot.api.sendMessage(e.telegramUserId, text, { reply_markup: kb });
      delivered += 1;
    } catch (err) {
      console.error(`notifyVacantSlot: failed for ${e.telegramUserId}:`, safeErrorMessage(err));
    }
  }
  return { delivered, intended: team.length };
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

/**
 * A shift offered to one colleague, with «Беру» / «Не могу» routed to
 * `handover:take:<id>` / `handover:decline:<id>`.
 */
export async function notifyHandoverOffer(
  bot: Bot,
  telegramUserId: number,
  handoverId: number,
  text: string,
): Promise<void> {
  const kb = new InlineKeyboard()
    .text("✅ Беру", `handover:take:${handoverId}`)
    .text("✖ Не могу", `handover:decline:${handoverId}`);
  try {
    await bot.api.sendMessage(telegramUserId, text, { reply_markup: kb });
  } catch (err) {
    console.error(`notifyHandoverOffer: failed for ${telegramUserId}:`, safeErrorMessage(err));
  }
}

/**
 * The fan-out: the same shift to everybody still free, one «Беру» each.
 *
 * No «Не могу» here on purpose. In a broadcast a refusal answers nothing — the
 * offer is not addressed to anyone in particular, and a row of «не могу» from
 * people who were never asked personally would only bury the one tap that
 * matters. Refusals are recorded from the personal offer, which is where they
 * change what happens next.
 */
export async function notifyHandoverFan(
  bot: Bot,
  db: Db,
  handoverId: number,
  employeeIds: readonly number[],
  text: string,
): Promise<void> {
  const kb = new InlineKeyboard().text("✅ Беру", `handover:take:${handoverId}`);
  for (const employeeId of employeeIds) {
    const telegramUserId = getEmployeeById(db, employeeId)?.telegramUserId;
    if (telegramUserId == null) continue;
    try {
      await bot.api.sendMessage(telegramUserId, text, { reply_markup: kb });
    } catch (err) {
      // One unreachable chat must not cut the broadcast short: the people after
      // this one in the list are exactly those who might still take the shift.
      console.error(`notifyHandoverFan: failed for ${telegramUserId}:`, safeErrorMessage(err));
    }
  }
}

/**
 * Письмо всем достижимым админам.
 *
 * `kind` — обязательный, и это главное в этой сигнатуре. Необязательный параметр
 * со значением по умолчанию однажды дал бы девятый вызов, который молча нельзя
 * выключить, и заметили бы это по жалобе. Здесь же tsc не даст добавить админское
 * уведомление, не решив, к какому виду оно относится.
 */
/**
 * Сколько писем админам пытались отправить и сколько дошло.
 *
 * Нужно отметкам «уже сказали»: тик, пометивший письмо до отправки, при обрыве
 * сети терял его молча. «Не дошло ни одно из попыток» — это обрыв, и отметку
 * надо снять; «попыток не было» (все выключили вид) — это решение людей.
 */
export interface AdminReach {
  attempted: number;
  delivered: number;
}

export function reachedNobody(reach: AdminReach): boolean {
  return reach.attempted > 0 && reach.delivered === 0;
}

/**
 * Кнопка про само событие — например «Разобрал» у багрепорта или «Открыть
 * график» у тревоги о пробеле. Едет ПЕРВОЙ строкой, над выключателем (если он
 * есть): она про то, что человек только что прочитал, а выключатель — про
 * поток вообще.
 *
 * Два варианта, а не один: `data` — обычный callback-обработчик (`bug:resolve`
 * и т.п.), `webApp` — инлайн-кнопка, открывающая мини-апп с подписанным
 * initData (см. `keyboard.ts`) — ей открывают график на нужной дате.
 */
export type AdminAction = { text: string; data: string } | { text: string; webApp: string };

function addActionButton(kb: InlineKeyboard, action: AdminAction): void {
  if ("webApp" in action) kb.webApp(action.text, action.webApp);
  else kb.text(action.text, action.data);
}

/** Ссылка на график мини-аппа на конкретную дату — кнопка «📅 Открыть график»
 *  у админских тревог открывает мини-апп сразу на нужной неделе. */
export function scheduleLink(publicUrl: string, date: string): string {
  return `${publicUrl}/app/?screen=schedule&date=${date}`;
}

export async function notifyAdmins(
  bot: Bot,
  db: Db,
  kind: AdminNoticeKind,
  text: string,
  action?: AdminAction,
): Promise<AdminReach> {
  const reach: AdminReach = { attempted: 0, delivered: 0 };
  // Кнопка едет с каждым выключаемым письмом по причине, уже записанной у
  // `notifyReminder`: за настройкой, о существовании которой не знаешь, не ходят.
  // Момент, когда админ хочет это выключить, наступает ровно тогда, когда оно у
  // него на экране.
  const kb = new InlineKeyboard();
  if (action) {
    addActionButton(kb, action);
    kb.row();
  }
  kb.text("🔕 Не писать мне про это", `notice:mute:${kind}`);
  for (const admin of listAdmins(db)) {
    if (admin.telegramUserId == null) continue;
    // Единственное место на весь проект, где эта проверка делается. Если она
    // понадобится где-то ещё — значит, письмо шлют мимо `notifyAdmins`, и чинить
    // надо это, а не копировать условие.
    if (isNoticeMuted(db, admin.id, kind)) continue;
    reach.attempted += 1;
    try {
      await bot.api.sendMessage(admin.telegramUserId, text, { reply_markup: kb });
      reach.delivered += 1;
    } catch (err) {
      console.error(`notifyAdmins(${kind}): failed for ${admin.telegramUserId}:`, safeErrorMessage(err));
    }
  }
  return reach;
}

/** Багрепорт админам, с кнопкой «Разобрал». Через `notifyAdmins`, а не своим
 *  циклом, — чтобы выключатель вида `bug_reports` работал и здесь. */
export async function notifyBugReport(bot: Bot, db: Db, reportId: number, text: string): Promise<void> {
  await notifyAdmins(bot, db, "bug_reports", text, { text: "✅ Разобрал", data: `bug:resolve:${reportId}` });
}

/**
 * То же самое, но выключить это нельзя.
 *
 * Отдельная функция, а не флаг «невыключаемый вид», намеренно: читающий место
 * вызова должен видеть, что письмо пройдёт сквозь любые настройки, не ходя за
 * определением. Сегодня так уходит ровно одно — «смену никто не взял».
 */
export async function notifyAdminsAlways(bot: Bot, db: Db, text: string, action?: AdminAction): Promise<AdminReach> {
  const reach: AdminReach = { attempted: 0, delivered: 0 };
  const kb = new InlineKeyboard();
  if (action) addActionButton(kb, action);
  for (const admin of listAdmins(db)) {
    if (admin.telegramUserId == null) continue;
    reach.attempted += 1;
    try {
      // Без действия — как и раньше, без клавиатуры вовсе: письмо, которое
      // нельзя выключить, не должно молча обрастать пустым рядом кнопок.
      await bot.api.sendMessage(admin.telegramUserId, text, action ? { reply_markup: kb } : undefined);
      reach.delivered += 1;
    } catch (err) {
      console.error(`notifyAdminsAlways: failed for ${admin.telegramUserId}:`, safeErrorMessage(err));
    }
  }
  return reach;
}
