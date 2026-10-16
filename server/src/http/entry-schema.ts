import { z } from "zod";
import {
  entryCategorySchema, timeStr, dateStr, categoryFitsDate, countsForBalance, isAbsence,
  ENTRY_LOCATION_MAX, ENTRY_NOTE_MAX, ENTRY_TITLE_MAX, tooLongText,
  type DayCalendar, type EntryCategory,
} from "@planer/shared";

/**
 * Подпись уходит в письмо об изменении графика, место — в напоминание накануне:
 * без потолка длинный текст рвёт письмо в Telegram. Потолки — `text-limits.ts`,
 * общие с вакантным слотом и с формами обеих морд.
 */
const entryTexts = {
  location: z.string().max(ENTRY_LOCATION_MAX, tooLongText("Место", ENTRY_LOCATION_MAX)).nullish(),
  title: z.string().max(ENTRY_TITLE_MAX, tooLongText("Название", ENTRY_TITLE_MAX)).nullish(),
  note: z.string().max(ENTRY_NOTE_MAX, tooLongText("Заметка", ENTRY_NOTE_MAX)).nullish(),
};

/**
 * Предел одной расстановки и одной записи-отсутствия — год с небольшим.
 *
 * Не вкусовое число: один процесс обслуживает и API, и long-polling бота, и
 * «широкий» запрос задевает чат всей команды (см. `CLAUDE.md`). Здесь он вдобавок
 * создаёт по записи на день, и без предела опечатка в году («2026» → «2126»)
 * означала бы тридцать шесть тысяч строк в таблице смен.
 */
export const MAX_RANGE_DAYS = 366;

/** Работа в выходной на будний день — админ ставит её из формы, причина нужна словами. */
export const WEEKEND_WORK_DAY_TEXT = "«Работа в выходной» может стоять только на выходной или праздник";

/** Конец раньше начала — тоже ошибка формы («по какой день» раньше «с какого»), а не клиента. */
export const ENDS_BEFORE_START_TEXT = "запись не может кончаться раньше, чем начинается";

/**
 * Отказ по длине записи. Его, как и длину поля, человек получает от своей же
 * формы («по какой день» через год), а не от сломанного клиента.
 */
export const RANGE_TOO_LONG_TEXT = `запись не может быть длиннее ${MAX_RANGE_DAYS} дней — разбейте её на части`;

const HUMAN_MESSAGES = new Set([
  tooLongText("Место", ENTRY_LOCATION_MAX),
  tooLongText("Название", ENTRY_TITLE_MAX),
  tooLongText("Заметка", ENTRY_NOTE_MAX),
  RANGE_TOO_LONG_TEXT,
  ENDS_BEFORE_START_TEXT,
  WEEKEND_WORK_DAY_TEXT,
]);

/**
 * Тело 400 для разбора записи. Обычный отказ остаётся `invalid`: его видит только
 * сломанный клиент. А длину человек набирает сам, и обе морды показывают `error`
 * как есть — поэтому слишком длинное поле называется словами.
 */
export function entryInvalidBody<T extends { message: string }>(issues: readonly T[]): { error: string; issues: readonly T[] } {
  const human = issues.find((issue) => HUMAN_MESSAGES.has(issue.message));
  return { error: human?.message ?? "invalid", issues };
}

const baseEntry = z.object({
  date: dateStr,
  category: entryCategorySchema.default("shift"),
  start: timeStr.nullish(),
  end: timeStr.nullish(),
  endDate: dateStr.nullish(),
  templateId: z.number().int().nullish(),
  employeeId: z.number().int().nullish(),
  ...entryTexts,
});

/** Category↔times coherence. Returns an error message, or null if coherent. */
export function entryTimesError(v: { category: EntryCategory; start?: string | null; end?: string | null }): string | null {
  if (countsForBalance(v.category) && (!v.start || !v.end)) return "timed categories require start and end";
  if (isAbsence(v.category) && (v.start || v.end)) return "absences must not have times";
  return null;
}

/**
 * Category↔date coherence.
 *
 * "Работа в выходной" is by definition a day off that got worked, so it can't land
 * on an ordinary working day. What counts as a day off comes from the holiday
 * calendar the caller passes in (`categoryFitsDate`): Sat/Sun by default, plus the
 * public holidays and minus the transferred working Saturdays that calendar lists.
 *
 * And only the three absences live as a range: both consoles offer «по какой день»
 * for those alone (`isMultiDay`), and the update path already drops `endDate` from
 * anything that counts as work. Creation was the one entry point that let a range through,
 * and a shift carrying one draws itself into every day of the span in both grids
 * and in the team schedule while the balance and the report count it once — the
 * same one shift, shown as five.
 *
 * Returns an error message, or null if coherent.
 */
export function entryDateError(
  v: { category: EntryCategory; date: string; endDate?: string | null },
  calendar: DayCalendar,
): string | null {
  // Само правило живёт в `categoryFitsDate` (@planer/shared): его второй
  // читатель — `planEntryRange`, который не должен класть в план день, который
  // эта проверка потом отвергнет.
  //
  // Календарь приходит параметром, потому что лежит в базе, а схема разбора
  // синхронна и базы не видит. Отсюда и разделение: «диапазоном пишутся только
  // отсутствия» проверяет схема (`entrySpanError`), а «в какой день годится
  // категория» — маршрут, который умеет прочитать праздники.
  if (!categoryFitsDate(v.category, v.date, calendar)) {
    return WEEKEND_WORK_DAY_TEXT;
  }
  return entrySpanError(v);
}

/** Многодневной бывает только полоса отсутствия — правило без календаря. */
export function entrySpanError(v: { category: EntryCategory; date: string; endDate?: string | null }): string | null {
  if (v.endDate && v.endDate !== v.date && !isAbsence(v.category)) {
    return "диапазоном записываются только отпуск, больничный и командировка";
  }
  return null;
}

/**
 * Range coherence: a multi-day entry cannot end before it starts.
 *
 * A backwards range is not a bad-looking row, it is an invisible one. Every reader
 * of a period asks the same question — `date <= d && (endDate ?? date) >= d` — and
 * for `20-е .. 10-е` no day answers yes: the entry is in neither console's grid,
 * nor the team schedule, nor the roster export. It still occupies a row, and fair
 * distribution reads the person as free, so the «отпуск» the admin just entered is
 * exactly when the bot books them.
 *
 * Returns an error message, or null if coherent.
 */
export function entryRangeError(v: { date: string; endDate?: string | null }): string | null {
  if (v.endDate && v.endDate < v.date) return ENDS_BEFORE_START_TEXT;
  // Длина — здесь же, а не только в схеме создания: этой функцией сверяют и PATCH
  // (итог после слияния с существующей записью), и записи работника. Без предела
  // больничный «до 9999 года» разворачивается `daysOf`/`eachDayIso` в ~36 млн
  // дней в процессе, который держит и бота.
  if (v.endDate && rangeDays(v.date, v.endDate) > MAX_RANGE_DAYS) {
    return RANGE_TOO_LONG_TEXT;
  }
  return null;
}

export const createEntrySchema = baseEntry.superRefine((v, ctx) => {
  const err = entryTimesError(v);
  if (err) ctx.addIssue({ code: "custom", path: ["start"], message: err });
  const dateErr = entrySpanError(v);
  if (dateErr) ctx.addIssue({ code: "custom", path: ["date"], message: dateErr });
  const rangeErr = entryRangeError(v);
  if (rangeErr) ctx.addIssue({ code: "custom", path: ["endDate"], message: rangeErr });
});

/**
 * Правка — без потолков в схеме: их сверяет `changedTextTooLong` против записи.
 * Формы шлют подпись, место и заметку заново в каждой правке, а записи старше
 * потолка бывают длиннее его — правка часов не должна упираться в поле, которое
 * никто не трогал.
 */
export const updateEntrySchema = baseEntry
  .extend({ location: z.string().nullish(), title: z.string().nullish(), note: z.string().nullish() })
  .partial();

const TEXT_CAPS = [
  ["title", "Название", ENTRY_TITLE_MAX],
  ["location", "Место", ENTRY_LOCATION_MAX],
  ["note", "Заметка", ENTRY_NOTE_MAX],
] as const;

/** Отказ за поле, которое правка МЕНЯЕТ и делает длиннее потолка; иначе null. */
export function changedTextTooLong(
  patch: { title?: string | null; location?: string | null; note?: string | null },
  existing: { title: string | null; location: string | null; note: string | null },
): string | null {
  for (const [field, label, max] of TEXT_CAPS) {
    const value = patch[field];
    if (value != null && value !== existing[field] && value.length > max) return tooLongText(label, max);
  }
  return null;
}

/**
 * Тело «расставить с какого по какое».
 *
 * Отдельная схема, а не `createEntrySchema` с двумя датами: у создания одной
 * записи `endDate` означает полосу отсутствия, а здесь `to` означает «до какого
 * дня расставлять» — то же поле в двух смыслах читалось бы неправильно ровно
 * там, где ошибка дороже всего.
 */
export const rangeEntrySchema = z
  .object({
    from: dateStr,
    to: dateStr,
    category: entryCategorySchema.default("shift"),
    start: timeStr.nullish(),
    end: timeStr.nullish(),
    templateId: z.number().int().nullish(),
    employeeId: z.number().int(),
    ...entryTexts,
    /** Брать ли субботу и воскресенье. К «Работе в выходной» не относится — у неё своё правило. */
    includeWeekends: z.boolean().default(false),
    /**
     * Что делать с занятым днём. По умолчанию — расстановка.
     *
     * Умолчание именно такое, потому что тело без `mode` шлют уже выкаченные
     * консоли: молча получить перезапись вместо расстановки — худшее, чем может
     * кончиться эта ручка, и цена ошибки здесь несимметрична.
     */
    mode: z.enum(["fill", "rewrite"]).default("fill"),
    /**
     * Заменить отпуск, больничный и командировку в днях, где встанет запись.
     * Умолчание «нет» по той же несимметричной цене, что у `mode`: тело без поля
     * шлют выкаченные консоли, и молча снести им отпуск — худший исход ручки.
     */
    replaceAbsences: z.boolean().default(false),
    /**
     * Заменить только ЭТО отсутствие — путь правки одного отпуска. Уже, чем
     * `replaceAbsences`: правка с «По», заехавшим на соседний отпуск, срезала бы
     * и его, а форма о нём не знает. Остальные отсутствия пропускаются.
     */
    replaceAbsenceEntryId: z.number().int().positive().optional(),
  })
  .superRefine((v, ctx) => {
    // Оба сразу — либо «все», либо «только это»: какое из правил имелось в
    // виду, не угадать, а ошибка в сторону «все» сносит чужой отпуск.
    if (v.replaceAbsences && v.replaceAbsenceEntryId != null) {
      ctx.addIssue({ code: "custom", path: ["replaceAbsenceEntryId"], message: "либо заменить все отсутствия, либо одно — не оба сразу" });
    }
    const err = entryTimesError(v);
    if (err) ctx.addIssue({ code: "custom", path: ["start"], message: err });
    if (v.to < v.from) ctx.addIssue({ code: "custom", path: ["to"], message: "диапазон не может кончаться раньше, чем начинается" });
    if (rangeDays(v.from, v.to) > MAX_RANGE_DAYS) {
      ctx.addIssue({ code: "custom", path: ["to"], message: `за один раз можно расставить не больше ${MAX_RANGE_DAYS} дней` });
    }
  });

/** Длина диапазона в днях, включительно. Считается по датам, а не по календарю дней. */
function rangeDays(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.floor(ms / 86_400_000) + 1;
}
