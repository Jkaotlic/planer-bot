import { InlineKeyboard, type Bot } from "grammy";
import { checklistText, checklistsDueToday } from "@planer/shared";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { activeChecklistItems, listMarksFor } from "../repo/checklist";
import { getChecklist } from "../repo/checklists";
import { getEmployeeById } from "../repo/employees";
import { listShiftsOverlapping } from "../repo/shifts";
import { listActiveTemplates } from "../repo/templates";
import { addReminder, hasReminder } from "../repo/reminders";
import { safeErrorMessage } from "../util/safe-error";

/**
 * Своё имя вида в `reminder_log`, рядом с `evening_before`: дедупликация та же
 * (одно письмо на смену на вид), а таблица уже есть и уже переживает рестарты.
 */
const CHECKLIST_KIND = "duty_checklist";

/**
 * Утреннее сообщение дежурному с чек-листом.
 *
 * Шлётся не «утром по часам», а с началом смены человека: у дежурства 07:00, у
 * другого вида — своё время, и жёсткий час означал бы сообщение либо до прихода,
 * либо через два часа после. Тик крутится каждые пять минут, поэтому
 * дедупликация обязательна — без неё это два десятка сообщений за смену.
 *
 * Молчит, когда в чек-листе ноль пунктов: рассылать пустую процедуру некому и
 * незачем, а список приезжает пустым по умолчанию (его наполняет админ).
 */
export async function runChecklistTick(
  db: Db,
  bot: Bot,
  config: Config,
  now: { date: string; time: string },
): Promise<number> {
  const byTemplate = new Map(
    listActiveTemplates(db).flatMap((t) => (t.checklistId != null ? [[t.id, t.checklistId] as const] : [])),
  );
  if (byTemplate.size === 0) return 0;

  const today = listShiftsOverlapping(db, now.date, now.date);
  let sent = 0;

  for (const shift of today) {
    const employeeId = shift.employeeId;
    if (employeeId == null) continue;
    // Чек-лист берётся у ЭТОЙ смены, а не «какой-нибудь сегодняшний»: у человека
    // в один день бывают две записи разных видов, и каждая приносит свой список
    // в своё время.
    const [checklistId] = checklistsDueToday([shift], byTemplate, now.date, employeeId);
    if (checklistId == null) continue;
    const list = getChecklist(db, checklistId);
    const items = activeChecklistItems(db, checklistId);
    if (!list || items.length === 0) continue;

    // Смена ещё не началась — человек не на этаже, и проверять нечего.
    if (shift.start != null && now.time < shift.start) continue;
    if (hasReminder(db, shift.id, CHECKLIST_KIND)) continue;

    const owner = getEmployeeById(db, employeeId);
    if (!owner || !owner.remindersEnabled || owner.telegramUserId == null) continue;

    const marked = listMarksFor(db, now.date, employeeId).map((m) => m.itemId);
    const settings = { note: list.note, docUrl: list.docUrl, docFileId: list.docFileId, docName: list.docName };
    const text = [
      `${list.name} — на сегодня:`,
      "",
      ...(settings.note ? [settings.note, ""] : []),
      checklistText(items, marked),
    ].join("\n");
    // `web_app`-кнопка в inline-клавиатуре, а не в обычной: из кнопки клавиатуры
    // Telegram не передаёт мини-аппу подпись, и вход падает с 401 — это уже
    // проходили 2026-08-12 (`keyboard.ts` носит тот же комментарий).
    // Без `?screen=…`: карточка чек-листа стоит первой на вкладке, которая
    // открывается по умолчанию, а параметр, которого `screenFromSearch` не
    // знает, обещал бы маршрут, которого нет.
    const kb = new InlineKeyboard().webApp("☑️ Отметить", `${config.publicUrl}/app/`);
    // Ссылка кнопкой, а не строкой в теле: в тексте она разворачивается превью и
    // отжимает сам список вниз, а нажать её всё равно надо отдельным касанием.
    if (settings.docUrl) kb.url("📄 Инструкция", settings.docUrl);

    try {
      // Документ первым: он контекст к списку, а не сноска после него. Один раз
      // в день — вместе с сообщением, которое дедуплицировано `reminder_log`.
      if (settings.docFileId) {
        await bot.api.sendDocument(owner.telegramUserId, settings.docFileId, {
          caption: settings.docName ? `📄 ${settings.docName}` : "📄 Инструкция дежурного",
        });
      }
      await bot.api.sendMessage(owner.telegramUserId, text, { reply_markup: kb });
      addReminder(db, shift.id, CHECKLIST_KIND);
      sent += 1;
    } catch (err) {
      // Одна неудача не должна оставить без чек-листа остальных дежурных: тот же
      // довод, что у `runReminderTick`. Пометки нет — следующий тик попробует
      // снова, и это правильно: чек-лист нужен в начале смены, а не назавтра.
      console.error(`runChecklistTick: shift ${shift.id} skipped:`, safeErrorMessage(err));
    }
  }

  return sent;
}
