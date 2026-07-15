import { z } from "zod";

export const entryCategorySchema = z.enum([
  "shift",
  "vacation",
  "sick_leave",
  "duty",
  "offsite",
  "business_trip",
  "weekend_work",
]);
export type EntryCategory = z.infer<typeof entryCategorySchema>;

const ABSENCES: ReadonlySet<EntryCategory> = new Set(["vacation", "sick_leave", "business_trip"]);
const BALANCE_COUNTED: ReadonlySet<EntryCategory> = new Set([
  "shift",
  "duty",
  "offsite",
  "weekend_work",
]);

/** Only regular shifts can be swapped between workers. */
export function isSwappable(category: EntryCategory): boolean {
  return category === "shift";
}

/** Absences (vacation, sick leave, business trip) — the worker is away, no times. */
export function isAbsence(category: EntryCategory): boolean {
  return ABSENCES.has(category);
}

/** Categories that count toward the fair-distribution balance (work, not absences). */
export function countsForBalance(category: EntryCategory): boolean {
  return BALANCE_COUNTED.has(category);
}
