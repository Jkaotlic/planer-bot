import { z } from "zod";
import { entryCategorySchema, timeStr, dateStr, countsForBalance, isAbsence, type EntryCategory } from "@planer/shared";

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

export const createEntrySchema = baseEntry.superRefine((v, ctx) => {
  const err = entryTimesError(v);
  if (err) ctx.addIssue({ code: "custom", path: ["start"], message: err });
});

export const updateEntrySchema = baseEntry.partial();

export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
