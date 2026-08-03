import { addressOf } from "@planer/shared";
import type { Bot } from "grammy";

import { notifyUser } from "../bot/notify";
import type { Db } from "../db/client";
import type { Shift } from "../db/schema";
import { getEmployeeById } from "../repo/employees";
import { entryLineOf } from "../util/message-lines";
import { diffSchedules } from "./schedule-diff";

/**
 * Род автора правки неизвестен: у работника есть имя, но не пол, и заводить
 * ради писем колонку «пол» — цена выше пользы. Форма `поставил(а)` уже принята
 * в этом боте (`отдал(а)`, `отказался(лась)` в `bot/notify.ts`), поэтому письма
 * про график говорят так же, а не «Антон поставила тебе смену».
 */
export function entryAddedText(actorName: string, line: string): string {
  return `${actorName} поставил(а) тебе смену: ${line}.`;
}

export function entryRemovedText(actorName: string, line: string): string {
  return `${actorName} снял(а) с тебя смену: ${line}.`;
}

/** Называет и «было», и «стало»: человеку важно, что именно у него поменялось. */
export function entryChangedText(actorName: string, before: string, after: string): string {
  return `${actorName} изменил(а) твою смену: было ${before} → стало ${after}.`;
}

/** До скольких из скольких дошло: `intended` считает и тех, у кого нет телеграма. */
export interface NotifyReach {
  delivered: number;
  intended: number;
}

interface EntryChangeOpts {
  actorEmployeeId: number;
  before: Shift | null;
  after: Shift | null;
  now: { date: string; time: string };
}

/**
 * Пишет человеку, что с его записью сделали.
 *
 * Зовётся ПОСЛЕ коммита: упавший Telegram не должен откатывать правку графика,
 * поэтому функция ничего не бросает и отвечает только тем, до скольких дошло.
 * Тумблер `remindersEnabled` здесь намеренно не спрашивается — это отдельный
 * канал (решение Антона, см. спеку): выключив шум напоминаний, человек не
 * отказывался узнавать, что его смену перенесли.
 */
export async function notifyEntryChange(
  db: Db,
  bot: Bot | undefined,
  opts: EntryChangeOpts,
): Promise<NotifyReach> {
  if (!bot) return { delivered: 0, intended: 0 };

  const diff = diffSchedules(opts.before ? [opts.before] : [], opts.after ? [opts.after] : []);
  const actor = getEmployeeById(db, opts.actorEmployeeId);
  const actorName = actor ? addressOf(actor) : "Админ";
  let delivered = 0;
  let intended = 0;

  for (const [employeeId, d] of diff) {
    if (employeeId === opts.actorEmployeeId) continue; // себе не пишем
    const texts: string[] = [];
    for (const s of d.added) if (!isPast(s, opts.now.date)) texts.push(entryAddedText(actorName, entryLineOf(s)));
    for (const s of d.removed) if (!isPast(s, opts.now.date)) texts.push(entryRemovedText(actorName, entryLineOf(s)));
    for (const c of d.changed) {
      // Перенос ИЗ прошлого в будущее — это про будущее, о нём сказать надо.
      if (isPast(c.before, opts.now.date) && isPast(c.after, opts.now.date)) continue;
      texts.push(entryChangedText(actorName, entryLineOf(c.before), entryLineOf(c.after)));
    }
    if (texts.length === 0) continue;

    intended += 1;
    const target = getEmployeeById(db, employeeId);
    if (target?.telegramUserId == null) continue;
    let ok = true;
    for (const text of texts) ok = (await notifyUser(bot, target.telegramUserId, text)) && ok;
    if (ok) delivered += 1;
  }
  return { delivered, intended };
}

/** Запись целиком в прошлом: даже её последний день раньше сегодняшнего. */
function isPast(s: Shift, today: string): boolean {
  return (s.endDate ?? s.date) < today;
}
