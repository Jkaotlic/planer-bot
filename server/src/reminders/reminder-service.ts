import type { Bot } from "grammy";
import {
  nextDate,
  prevDate,
  addDaysIso,
  dutyRun,
  remindsByDefault,
  reminderKind,
  wakeTime,
  buildReminderText,
  renderReminderText,
  addressOf,
  coworkersEnumeration,
  shiftsOverlap,
} from "@planer/shared";
import type { Db } from "../db/client";
import { listShiftsInRange, listDatesHolding } from "../repo/shifts";
import { getEmployeeById } from "../repo/employees";
import { getTemplate } from "../repo/templates";
import { reminderHour } from "../repo/settings";
import { hasReminder, addReminder } from "../repo/reminders";
import { recordAudit } from "../repo/audit";
import { notifyReminder } from "../bot/notify";
import { safeErrorMessage } from "../util/safe-error";
import type { EntryCategory } from "@planer/shared";
import type { Shift, ShiftTemplate } from "../db/schema";

const REMINDER_KIND = "evening_before";

/**
 * Насколько далеко вперёд ищется конец отрезка дежурства.
 *
 * Дежурство длиннее месяца — не отрезок, а ошибка в графике, и уводить письмо
 * на такую дату не за чем. Окно заодно ограничивает запрос: без него он читал бы
 * всю историю человека по этому виду смены.
 */
const MAX_DUTY_RUN_DAYS = 31;

/**
 * Вид смены записи, если он у неё есть.
 *
 * Записи без вида смены — не редкость: их приносит импорт ростера и ручное
 * добавление в графике. Для них решать нечему, и правило остаётся прежним.
 */
function templateOf(db: Db, shift: Shift): ShiftTemplate | undefined {
  return shift.templateId == null ? undefined : getTemplate(db, shift.templateId);
}

/**
 * Напоминать ли про эту смену: галочка вида смены, а если вида нет — правило
 * «всё, кроме обычного дня» (`remindsByDefault`).
 *
 * Раньше решала только эвристика по часам, и админ не мог ни включить
 * напоминание про дежурство с девяти, ни выключить его про вечернюю.
 */
function wantsReminder(
  shift: { start: string; end: string; category: EntryCategory; templateId: number | null },
  template: ShiftTemplate | undefined,
): boolean {
  if (shift.templateId != null && template) return template.sendReminder;
  return remindsByDefault({ start: shift.start, end: shift.end, category: shift.category });
}

/** Sends soft evening-before reminders for tomorrow's morning/night shifts. Returns the number sent. */
export async function runReminderTick(db: Db, bot: Bot, now: { date: string; time: string }, publicUrl?: string): Promise<number> {
  // Час — настройка админа, а не константа. Строки нет — те же 20:00, что и до неё.
  if (now.time < reminderHour(db)) return 0;

  const tomorrow = nextDate(now.date);
  const shifts = listShiftsInRange(db, tomorrow, tomorrow).filter(
    (s) =>
      s.employeeId != null &&
      s.start != null &&
      s.end != null &&
      wantsReminder(
        { start: s.start, end: s.end, category: s.category, templateId: s.templateId },
        templateOf(db, s),
      ),
  );

  let count = 0;
  for (const shift of shifts) {
    try {
      count += await remindFor(db, bot, shift, publicUrl);
    } catch (err) {
      // The list of shifts was read once, up front, and each send below awaits
      // Telegram — an admin deleting tomorrow's shift in that gap leaves the
      // «reminder sent» write pointing at a row that no longer exists. That used
      // to throw out of this loop, so everybody further down the list got nothing
      // that evening and nothing said why. One person's shift going wrong is not
      // a reason for the other twenty to stay unreminded.
      console.error(`runReminderTick: shift ${shift.id} skipped:`, safeErrorMessage(err));
    }
  }

  // Одна строка на прогон, а не на человека: тик крутится каждые пять минут весь
  // вечер, и поштучные записи утопили бы всё остальное в журнале. Молчим, когда
  // ушло ноль — «ничего не произошло» не событие, а `hasReminder` дедуплицирует
  // отправку, так что второй тик за вечер сюда уже не дойдёт.
  if (count > 0) {
    recordAudit(db, "reminders_dispatched", null, { forDate: tomorrow, sent: count, considered: shifts.length });
  }
  return count;
}

/**
 * Кто ещё работает в этот день — для строки «Завтра с тобой».
 *
 * Только записи с другим `employeeId` и заданными часами (отсутствия — вроде
 * отпуска Семёна — часов не имеют и не попадают в список), чьё время
 * пересекается со сменой владельца (`shiftsOverlap`, а не просто «тот же
 * день»: сосед с 18:00 не «с тобой», если твоя смена кончилась в 17:00).
 * Имя — через `addressOf`, как и у самого адресата письма.
 *
 * Дедуп по `employeeId`, а не по имени: у одного человека в этот день может
 * стоять больше одной пересекающейся записи (например, дежурство и подработка
 * рядом), и без дедупа он попал бы в перечень дважды под одним и тем же именем.
 */
function coworkerNamesFor(db: Db, shift: { date: string; start: string; end: string; employeeId: number | null }): string[] {
  const dayShifts = listShiftsInRange(db, shift.date, shift.date);
  const seen = new Set<number>();
  const names: string[] = [];
  for (const other of dayShifts) {
    if (other.employeeId == null || other.employeeId === shift.employeeId) continue;
    if (other.start == null || other.end == null) continue;
    if (seen.has(other.employeeId)) continue;
    if (!shiftsOverlap({ date: shift.date, start: shift.start, end: shift.end }, { date: other.date, start: other.start, end: other.end })) continue;
    const person = getEmployeeById(db, other.employeeId);
    if (!person) continue;
    seen.add(other.employeeId);
    names.push(addressOf(person));
  }
  return names;
}

/**
 * Отрезок дежурства, в который попадает эта запись, — или `undefined`, если
 * запись не дежурство и отрезка у неё нет.
 *
 * Без `templateId` отрезок не считается: связать «то же самое дежурство» между
 * двумя днями больше нечем, а угадывать по названию значило бы склеить два
 * разных дежурства в одном месте.
 */
function runOf(db: Db, shift: Shift, template: ShiftTemplate | undefined) {
  if (!template || template.category === "shift" || shift.employeeId == null || shift.templateId == null) return undefined;
  const until = addDaysIso(shift.date, MAX_DUTY_RUN_DAYS);
  const held = listDatesHolding(db, shift.employeeId, shift.templateId, prevDate(shift.date), until);
  return dutyRun(new Set(held), shift.date);
}

/** One shift's reminder. Returns 1 if it went out, 0 otherwise. */
async function remindFor(db: Db, bot: Bot, shift: Shift, publicUrl?: string): Promise<number> {
    if (hasReminder(db, shift.id, REMINDER_KIND)) return 0;
    const owner = getEmployeeById(db, shift.employeeId!);
    if (!owner || !owner.remindersEnabled || owner.telegramUserId == null) return 0;

    const start = shift.start!;
    const end = shift.end!;
    const kind = reminderKind({ start, end });
    // The name they gave Telegram, not the roster's «Фамилия Имя» — a reminder
    // that opens «Привет, Петров» reads as a roll-call. See `addressOf`.
    const name = addressOf(owner);
    const timeRange = `${start}–${end}`;
    const wake = wakeTime(start, owner.prepBufferMin);
    // Свой текст вида смены, если админ его написал. Пустого текста в колонке
    // не бывает — эндпоинт пишет туда `null`, — но `trim` дешевле веры в это.
    const template = templateOf(db, shift);
    const run = runOf(db, shift, template);
    // Про недельное дежурство пишут ОДИН раз, накануне первого дня — для рабочей
    // недели это воскресенье вечером. Дальше человек уже знает, и пять писем
    // подряд научили бы его их не читать.
    if (run?.continuing) return 0;
    const custom = template?.reminderText?.trim();
    // Название — только у дежурств и прочей не-рутины: письмо про дежурство
    // иначе слово в слово совпало бы с письмом про обычную смену.
    const what = template && template.category !== "shift" ? template.name : undefined;
    const until = run && run.lastDate !== shift.date ? run.lastDate : undefined;
    // Время подъёма живёт только в СВОЁМ тексте, через `{подъём}`: в стандартных
    // формулировках его нет ни у одного вида смены — распоряжаться чужим
    // будильником письмо не должно.
    const location = shift.location;
    // «Завтра с тобой» — только у смен категории «смена» (не у дежурств и
    // прочей не-рутины) и только для ранней, утренней, вечерней и ночной
    // (решение владельца от 2026-09-25).
    //
    // Дежурство НЕ всегда день: Поклонка в 07:00–16:00 — то же дежурство, что и
    // 09:00–18:00, и по одним часам их не отличить (`kind` для первого — уже
    // "early", а не "day"). Гейта по `kind === "day"` одного было недостаточно —
    // дежурство в ранние или поздние часы получало бы список соседей, которые
    // для дежурного не новость: он и так каждый раз выходит в те же часы, что и
    // обычная смена. Категорию решает вид смены (`template.category`), а без
    // него — решать нечем, и остаётся только правило по `kind` (как и везде
    // выше в этой функции).
    const isNonShiftKind = template != null && template.category !== "shift";
    const coworkers =
      kind === "day" || isNonShiftKind
        ? []
        : coworkerNamesFor(db, { date: shift.date, start, end, employeeId: shift.employeeId });
    const text = custom
      ? renderReminderText(custom, { name, timeRange, wake, location: location ?? "", coworkers: coworkersEnumeration(coworkers) }, kind)
      : buildReminderText({ name, kind, timeRange, what, until, location, coworkers });

    const appUrl = publicUrl ? `${publicUrl}/app/` : undefined;
    const outcome = await notifyReminder(bot, owner.telegramUserId, text, appUrl);
    if (outcome.ok) {
      addReminder(db, shift.id, REMINDER_KIND);
      return 1;
    }
    if (outcome.permanent) {
      // A blocked bot or a deleted account refuses every time, and this tick runs
      // every five minutes all evening — so retrying is ~48 hopeless calls a night,
      // forever. Mark it done to stop the loop, and record it: somebody quietly no
      // longer hearing from the bot is a fact an admin needs, and the journal is
      // where this system already tells them things. A busy Telegram (429, 5xx, a
      // dropped connection) is NOT marked and is retried on the next tick, which is
      // the behaviour the test above pins.
      addReminder(db, shift.id, REMINDER_KIND);
      recordAudit(db, "reminder_undeliverable", null, {
        employeeId: owner.id,
        displayName: owner.displayName,
        shiftId: shift.id,
        errorCode: outcome.errorCode,
      });
    }
    return 0;
}
