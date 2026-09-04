import { z } from "zod";
import { entryCategorySchema, timeStr, dateStr, categoryFitsDate, countsForBalance, isAbsence, EMPTY_CALENDAR, type DayCalendar, type EntryCategory } from "@planer/shared";

const baseEntry = z.object({
  date: dateStr,
  category: entryCategorySchema.default("shift"),
  start: timeStr.nullish(),
  end: timeStr.nullish(),
  endDate: dateStr.nullish(),
  templateId: z.number().int().nullish(),
  employeeId: z.number().int().nullish(),
  location: z.string().nullish(),
  title: z.string().nullish(),
  note: z.string().nullish(),
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
 * on a weekday. (Weekend = Sat/Sun — there's no holiday calendar, so a public
 * holiday on a weekday isn't recognised as a day off yet.)
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
  if (!categoryFitsDate(v.category, v.date, calendar)) {
    return "«Работа в выходной» может стоять только на субботу или воскресенье";
  }
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
  if (v.endDate && v.endDate < v.date) return "запись не может кончаться раньше, чем начинается";
  return null;
}

export const createEntrySchema = baseEntry.superRefine((v, ctx) => {
  const err = entryTimesError(v);
  if (err) ctx.addIssue({ code: "custom", path: ["start"], message: err });
  const dateErr = entryDateError(v, EMPTY_CALENDAR);
  if (dateErr) ctx.addIssue({ code: "custom", path: ["date"], message: dateErr });
  const rangeErr = entryRangeError(v);
  if (rangeErr) ctx.addIssue({ code: "custom", path: ["endDate"], message: rangeErr });
});

export const updateEntrySchema = baseEntry.partial();

/**
 * Предел одной расстановки — год с небольшим.
 *
 * Не вкусовое число: один процесс обслуживает и API, и long-polling бота, и
 * «широкий» запрос задевает чат всей команды (см. `CLAUDE.md`). Здесь он вдобавок
 * создаёт по записи на день, и без предела опечатка в году («2026» → «2126»)
 * означала бы тридцать шесть тысяч строк в таблице смен.
 */
export const MAX_RANGE_DAYS = 366;

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
    location: z.string().nullish(),
    title: z.string().nullish(),
    note: z.string().nullish(),
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
  })
  .superRefine((v, ctx) => {
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
