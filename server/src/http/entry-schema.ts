import { z } from "zod";
import { entryCategorySchema, timeStr, dateStr, countsForBalance, isAbsence, isWeekend, type EntryCategory } from "@planer/shared";

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
 * Category↔date coherence: "работа в выходной" is by definition a day off that got
 * worked, so it can't land on a weekday. (Weekend = Sat/Sun — there's no holiday
 * calendar, so a public holiday on a weekday isn't recognised as a day off yet.)
 * Returns an error message, or null if coherent.
 */
export function entryDateError(v: { category: EntryCategory; date: string }): string | null {
  if (v.category === "weekend_work" && !isWeekend(v.date)) {
    return "«Работа в выходной» может стоять только на субботу или воскресенье";
  }
  return null;
}

export const createEntrySchema = baseEntry.superRefine((v, ctx) => {
  const err = entryTimesError(v);
  if (err) ctx.addIssue({ code: "custom", path: ["start"], message: err });
  const dateErr = entryDateError(v);
  if (dateErr) ctx.addIssue({ code: "custom", path: ["date"], message: dateErr });
});

export const updateEntrySchema = baseEntry.partial();

export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
