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
  buildCatchUpText,
  addressOf,
  coworkersEnumeration,
  isAbsentOn,
  clampTelegramText,
  TELEGRAM_TEXT_SAFE_MAX,
} from "@planer/shared";
import type { Db } from "../db/client";
import { getShift, listShiftsInRange, listShiftsOverlapping, listEmployeeShiftsOverlapping, listDatesHolding } from "../repo/shifts";
import { employeesByIds, getEmployeeById } from "../repo/employees";
import { getTemplate, templatesByIds } from "../repo/templates";
import { reminderHour } from "../repo/settings";
import { hasEveningReminder, eveningReminderKind, addReminder } from "../repo/reminders";
import { recordAudit, saveReminderDispatchAudit, type ReminderDelivery } from "../repo/audit";
import { notifyReminder } from "../bot/notify";
import { safeErrorMessage } from "../util/safe-error";
import type { EntryCategory, ReminderKind } from "@planer/shared";
import type { Shift, ShiftTemplate } from "../db/schema";


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

/**
 * Смены этого дня, про которые хотят напоминания и чей хозяин на месте.
 *
 * Больной не получает «Завтра смена» про смену, которую отдаёт (решение
 * владельца от 2026-09-28): до решения по передаче она стоит на нём. Отпуск и
 * больничный, начатые раньше, этот день покрывают, а не начинают —
 * `listShiftsInRange` их не видит, поэтому отсутствия читаются с пересечением.
 */
function remindableOn(db: Db, date: string): Shift[] {
  const dayEntries = listShiftsOverlapping(db, date, date);
  const dayShifts = listShiftsInRange(db, date, date);
  // Виды смен дня — одним запросом, а не на каждую запись.
  const templates = templatesByIds(db, dayShifts.map((s) => s.templateId));
  return dayShifts.filter(
    (s) =>
      s.employeeId != null &&
      !isAbsentOn(dayEntries, s.employeeId, date) &&
      s.start != null &&
      s.end != null &&
      wantsReminder(
        { start: s.start, end: s.end, category: s.category, templateId: s.templateId },
        s.templateId == null ? undefined : templates.get(s.templateId),
      ),
  );
}

/**
 * Вечерние напоминания про завтра — и догоняющие про сегодня.
 *
 * Догоняющая ветка работает в любое время суток (решение владельца от
 * 2026-09-28: «сразу, как бот ожил», даже ночью): вечернее не ушло — бот лежал,
 * не было сети, смену поставили поздно, — а смена сегодня и ещё не началась.
 * Пометка у обеих веток одна, `evening_before:<id>`, так что дубля не бывает.
 * Returns the number sent.
 */
export async function runReminderTick(
  db: Db,
  bot: Bot,
  now: ReminderTime | (() => ReminderTime),
  publicUrl?: string,
  widgetEnabled = false,
): Promise<number> {
  const readTime = typeof now === "function" ? now : () => now;
  const caughtUp = await runReminderPass(db, bot, { mode: "catchUp", date: readTime().date, readTime }, publicUrl);
  const evening = readTime();
  if (evening.time < reminderHour(db)) return caughtUp;
  const sent = await runReminderPass(db, bot, { mode: "evening", date: nextDate(evening.date), readTime }, publicUrl, widgetEnabled);
  return caughtUp + sent;
}

type ReminderTime = { date: string; time: string };
type ReminderPass = {
  mode: "evening" | "catchUp";
  date: string;
  readTime(): ReminderTime;
};
async function runReminderPass(
  db: Db,
  bot: Bot,
  pass: ReminderPass,
  publicUrl: string | undefined,
  widgetEnabled = false,
): Promise<number> {
  const catchUp = pass.mode === "catchUp";
  const { time } = pass.readTime();
  const shifts = remindableOn(db, pass.date).filter((shift) => !catchUp || time < shift.start!);
  let deliveries: ReminderDelivery[] = [];
  let auditId: number | undefined;
  for (const { id } of shifts) {
    try {
      const delivered = await remindFor(db, bot, id, pass, publicUrl, widgetEnabled);
      if (!delivered) continue;
      const confirmed = [...deliveries, delivered];
      // Записываем подтверждение с отметкой одной транзакцией, пока следующий
      // запрос ещё не начался. В журнале остаётся одна строка на рассылку.
      auditId = db.transaction((tx) => {
        // Смена могла исчезнуть или переехать, пока запрос шёл. Итог нужен
        // журналу, но отправка на прежнюю дату не закрывает новую.
        if (getShift(tx, id)?.date === pass.date) addReminder(tx, id, eveningReminderKind(delivered.employeeId));
        return saveReminderDispatchAudit(tx, auditId, {
          forDate: pass.date,
          sent: confirmed.length,
          considered: shifts.length,
          ...(catchUp ? { catchUp: true } : {}),
          deliveries: confirmed,
        });
      });
      deliveries = confirmed;
    } catch (error) {
      // Одна проблемная смена не должна оставить без письма остальных.
      console.error(`runReminderTick: shift ${id} failed:`, safeErrorMessage(error));
    }
  }
  return deliveries.length;
}

/**
 * Запись — не рутинная «смена»: дежурство, выездное, выход в выходной.
 *
 * Категорию решает сама запись (`shift.category`) — она есть всегда, даже без
 * вида смены (импорт ростера, ручная запись); вид смены может только сузить
 * дальше (шаблон дежурства над записью без своей категории), но не вернуть
 * запись обратно в «смену».
 */
function isNonShiftKind(shift: Shift, template: ShiftTemplate | undefined): boolean {
  return shift.category !== "shift" || (template != null && template.category !== "shift");
}

/**
 * Кто завтра в той же смене — для строки «Завтра с тобой». С `kind:
 * "evening"` у ночного — для строки «до вечера»: отбор тот же, меняется вид.
 *
 * «С тобой» — это тот же вид смены по часам (`reminderKind`): утро с утром,
 * вечер с вечером, ночь с ночью. Раньше хватало пересечения часов, и утренний
 * 08:00–17:00 получал почти всю команду — «День» 09:00–18:00 пересекается с
 * ним на восемь часов. Перечень, в котором все, никому не нужен (его решение
 * от 2026-09-28). Отсутствия часов не имеют и в список не попадают.
 *
 * Сосед — только «смена», по тому же правилу, что и адресат (`isNonShiftKind`
 * ниже): дежурный, выездное или выход в выходной в те же часы — не «с тобой»,
 * у них своё место и своё дело.
 *
 * Имя — как забито в графике (`displayName`), а не Telegram-имя из
 * `addressOf`: «Кирюха» в перечне не опознать, человек ищет коллегу по тому
 * же имени, что видит в расписании. Приветствие адресату остаётся на
 * `addressOf` — там обращаются к нему самому.
 *
 * Дедуп по `employeeId`, а не по имени: у одного человека в этот день может
 * стоять больше одной записи того же вида (например, смена и подработка
 * рядом), и без дедупа он попал бы в перечень дважды.
 *
 * Отсутствующего в перечне нет: смена, которую больной отдаёт, до решения по
 * передаче стоит на нём, но «с тобой» он завтра не будет. Записи дня читаются
 * с пересечением, чтобы увидеть больничный, начатый раньше; сами соседи — только
 * смены, начинающиеся в этот день.
 */
function coworkerNamesFor(db: Db, shift: { date: string; kind: ReminderKind; employeeId: number | null }): string[] {
  const dayShifts = listShiftsOverlapping(db, shift.date, shift.date);
  // Люди и виды смен дня — по запросу на всех, а не на соседа: перечень строится для
  // каждого письма, и запрос на соседа давал квадрат от команды за вечер.
  const templates = templatesByIds(db, dayShifts.map((s) => s.templateId));
  const people = employeesByIds(db, dayShifts.flatMap((s) => (s.employeeId == null ? [] : [s.employeeId])));
  const seen = new Set<number>();
  const names: string[] = [];
  for (const other of dayShifts) {
    if (other.employeeId == null || other.employeeId === shift.employeeId) continue;
    if (other.start == null || other.end == null) continue;
    if (other.date !== shift.date) continue;
    if (seen.has(other.employeeId)) continue;
    if (isAbsentOn(dayShifts, other.employeeId, shift.date)) continue;
    if (reminderKind({ start: other.start, end: other.end }) !== shift.kind) continue;
    if (isNonShiftKind(other, other.templateId == null ? undefined : templates.get(other.templateId))) continue;
    const person = people.get(other.employeeId);
    if (!person) continue;
    seen.add(other.employeeId);
    names.push(person.displayName);
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

function prepareReminder(db: Db, shiftId: number, pass: ReminderPass) {
  const now = pass.readTime();
  const shift = getShift(db, shiftId);
  if (!shift || shift.date !== pass.date || shift.employeeId == null || shift.start == null || shift.end == null) return;
  if (pass.mode === "evening") {
    if (shift.date !== nextDate(now.date) || now.time < reminderHour(db)) return;
  } else if (shift.date !== now.date || now.time >= shift.start) {
    return;
  }

  // Список кандидатов прочитан до первой отправки. Пока она ждала Telegram,
  // смена могла перейти к другому человеку или её условия могли измениться.
  const template = templateOf(db, shift);
  const { start, end, location, employeeId } = shift;
  if (!wantsReminder({ start, end, category: shift.category, templateId: shift.templateId }, template)) return;
  if (hasEveningReminder(db, shift.id, employeeId)) return;
  const owner = getEmployeeById(db, employeeId);
  if (!owner?.isActive || !owner.remindersEnabled || owner.telegramUserId == null) return;
  if (isAbsentOn(listEmployeeShiftsOverlapping(db, employeeId, shift.date, shift.date), employeeId, shift.date)) return;

  const run = runOf(db, shift, template);
  // О непрерывном дежурстве пишем один раз, накануне первого дня.
  if (run?.continuing) return;

  // В приветствии используем имя, которым человек представился в Telegram.
  const name = addressOf(owner);
  const timeRange = `${start}–${end}`;
  let text: string;
  if (pass.mode === "catchUp") {
    text = buildCatchUpText({ name, timeRange, location });
  } else {
    const kind = reminderKind({ start, end });
    const what = template && template.category !== "shift" ? template.name : undefined;
    const until = run && run.lastDate !== shift.date ? run.lastDate : undefined;
    // Ночному показываем и вечерних коллег: он застанет их в начале смены.
    // Раннее дежурство по часам похоже на раннюю смену, но коллеги из
    // обычной смены ему не нужны. Категорию решает запись, а не время начала.
    const ordinaryShift = !isNonShiftKind(shift, template);
    const coworkers = kind !== "day" && ordinaryShift
      ? coworkerNamesFor(db, { date: shift.date, kind, employeeId })
      : [];
    const eveningCoworkers = kind === "night" && ordinaryShift
      ? coworkerNamesFor(db, { date: shift.date, kind: "evening", employeeId })
      : [];
    const custom = template?.reminderText?.trim();
    const expanded = custom ? renderReminderText(custom, {
      name,
      timeRange,
      // Время подъёма добавляется только по явной подстановке в своём тексте.
      wake: wakeTime(start, owner.prepBufferMin),
      location: location ?? "",
      coworkers: coworkersEnumeration(coworkers),
      eveningCoworkers: coworkersEnumeration(eveningCoworkers),
    }, kind) : "";
    // Лимит на шаблон не ограничивает длину подстановок. Отказ за пустой или
    // слишком длинный текст раньше гасил также утреннее письмо.
    text = expanded.trim() && expanded.length <= TELEGRAM_TEXT_SAFE_MAX
      ? expanded
      : buildReminderText({ name, kind, timeRange, what, until, location, coworkers, eveningCoworkers });
  }

  return {
    owner,
    telegramUserId: owner.telegramUserId,
    text: clampTelegramText(text, () => "Подробности — в графике."),
    widget: { date: shift.date, start, timeRange, location },
  };
}

async function remindFor(
  db: Db,
  bot: Bot,
  shiftId: number,
  pass: ReminderPass,
  publicUrl: string | undefined,
  widgetEnabled: boolean,
): Promise<ReminderDelivery | undefined> {
  const reminder = prepareReminder(db, shiftId, pass);
  if (!reminder) return;
  const { owner, telegramUserId, text } = reminder;
  const appUrl = publicUrl ? `${publicUrl}/app/` : undefined;
  const widget = widgetEnabled && pass.mode === "evening" ? reminder.widget : undefined;
  const outcome = await notifyReminder(bot, telegramUserId, text, appUrl, widget, () => {
    // Виджет мог отказать после переназначения или правки. Текстовое письмо —
    // новый запрос, и для него прежний адресат и содержание уже ненадёжны.
    const current = prepareReminder(db, shiftId, pass);
    return current?.owner.id === owner.id && current.telegramUserId === telegramUserId && current.text === text;
  });
  if (!outcome) return;

  if (outcome.ok) return { shiftId, employeeId: owner.id, message_id: outcome.messageId ?? null };
  if (outcome.permanent) {
    if (getShift(db, shiftId)?.date === pass.date) addReminder(db, shiftId, eveningReminderKind(owner.id));
    recordAudit(db, "reminder_undeliverable", null, {
      employeeId: owner.id,
      displayName: owner.displayName,
      shiftId,
      errorCode: outcome.errorCode,
    });
  }
}
