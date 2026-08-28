import { existsSync } from "node:fs";
import { InlineKeyboard, InputFile, type Bot } from "grammy";
import { checklistHasContent, checklistText, checklistsDueToday } from "@planer/shared";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { activeChecklistItems, listMarksFor } from "../repo/checklist";
import { getChecklist, updateChecklist } from "../repo/checklists";
import { getEmployeeById } from "../repo/employees";
import { listShiftsOverlapping } from "../repo/shifts";
import { listActiveTemplates } from "../repo/templates";
import { addReminder, CHECKLIST_KIND, hasReminder } from "../repo/reminders";
import { safeErrorMessage } from "../util/safe-error";

/**
 * Утреннее сообщение дежурному с чек-листом.
 *
 * Шлётся не «утром по часам», а с началом смены человека: у дежурства 07:00, у
 * другого вида — своё время, и жёсткий час означал бы сообщение либо до прихода,
 * либо через два часа после. Тик крутится каждые пять минут, поэтому
 * дедупликация обязательна — без неё это два десятка сообщений за смену.
 *
 * Уходит независимо от личной галочки напоминаний — см. довод у проверки
 * `owner` ниже.
 *
 * Пунктов может не быть вовсе, и это не повод молчать: пояснение и приложенная
 * инструкция — уже полноценное сообщение дежурному, а список пунктов админ
 * заводит не всегда. Раньше условием была непустота списка, и у «Дежурств 47»,
 * где были и пояснение, и docx, не ушло ничего и никогда (2026-08-26).
 * Молчание осталось ровно для пустоты: ни пунктов, ни пояснения, ни файла —
 * рассылать нечего.
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
    if (!list) continue;
    const items = activeChecklistItems(db, checklistId);
    const hasDoc = Boolean(list.docUrl || list.docFileId || list.docPath);
    if (!checklistHasContent({ items, note: list.note, hasDoc })) continue;

    // Смена ещё не началась — человек не на этаже, и проверять нечего.
    if (shift.start != null && now.time < shift.start) continue;
    if (hasReminder(db, shift.id, CHECKLIST_KIND)) continue;

    // Личная галочка «не пиши мне про смены» здесь НЕ проверяется, в отличие от
    // `runReminderTick`: вечернее напоминание — удобство, от которого человек
    // вправе отказаться, а чек-лист дежурного — рабочая инструкция на его смену.
    // Пока флаг был общим, трое выключили 🔕 под напоминанием и на месяц остались
    // без инструкций, ни разу об этом не узнав (2026-08-28).
    const owner = getEmployeeById(db, employeeId);
    if (!owner || owner.telegramUserId == null) continue;

    const marked = listMarksFor(db, now.date, employeeId).map((m) => m.itemId);
    const settings = {
      note: list.note, docUrl: list.docUrl, docFileId: list.docFileId,
      docName: list.docName, docPath: list.docPath,
    };
    // Без пунктов заголовок «— на сегодня:» и «Сделано 0 из 0» обещали бы список,
    // которого в сообщении нет: на экране это читается как поломка, а не как
    // инструкция. Поэтому в таком сообщении остаются имя, пояснение и файл.
    const text = [
      items.length > 0 ? `${list.name} — на сегодня:` : list.name,
      "",
      ...(settings.note ? [settings.note, ""] : []),
      ...(items.length > 0 ? [checklistText(items, marked)] : []),
    ]
      .join("\n")
      .trimEnd();
    const kb = new InlineKeyboard();
    // «Отметить» — только когда есть что отмечать: карточка без пунктов пуста, и
    // кнопка обещала бы маршрут, которого нет — тот же довод, что и у `?screen=…`
    // ниже.
    //
    // `web_app`-кнопка в inline-клавиатуре, а не в обычной: из кнопки клавиатуры
    // Telegram не передаёт мини-аппу подпись, и вход падает с 401 — это уже
    // проходили 2026-08-12 (`keyboard.ts` носит тот же комментарий).
    // Без `?screen=…`: карточка чек-листа стоит первой на вкладке, которая
    // открывается по умолчанию, а параметр, которого `screenFromSearch` не
    // знает, обещал бы маршрут, которого нет.
    if (items.length > 0) kb.webApp("☑️ Отметить", `${config.publicUrl}/app/`);
    // Ссылка кнопкой, а не строкой в теле: в тексте она разворачивается превью и
    // отжимает сам список вниз, а нажать её всё равно надо отдельным касанием.
    if (settings.docUrl) kb.url("📄 Инструкция", settings.docUrl);

    try {
      // Документ первым: он контекст к списку, а не сноска после него. Один раз
      // в день — вместе с сообщением, которое дедуплицировано `reminder_log`.
      const caption = settings.docName ? `📄 ${settings.docName}` : "📄 Инструкция дежурного";
      if (settings.docFileId) {
        await bot.api.sendDocument(owner.telegramUserId, settings.docFileId, { caption });
      } else if (settings.docPath && existsSync(settings.docPath)) {
        // С диска — только первый раз. Ответ Telegram содержит идентификатор
        // файла, и он же становится кэшем: следующая отправка не читает диск и
        // не гонит мегабайты через канал, который держит и API, и бота.
        //
        // Файла может не оказаться на месте — его могли убрать руками; список
        // дежурному нужен всё равно, поэтому это не ошибка, а пропуск.
        const posted = await bot.api.sendDocument(
          owner.telegramUserId,
          new InputFile(settings.docPath, settings.docName ?? undefined),
          { caption },
        );
        const fileId = posted?.document?.file_id;
        if (fileId) updateChecklist(db, list.id, { docFileId: fileId });
      }
      // Клавиатура прикладывается, только если в ней есть кнопки: пустой
      // `inline_keyboard` — это разметка ради разметки.
      const markup = kb.inline_keyboard.flat().length > 0 ? { reply_markup: kb } : undefined;
      await bot.api.sendMessage(owner.telegramUserId, text, markup);
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
