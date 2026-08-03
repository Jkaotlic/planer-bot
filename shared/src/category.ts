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

/**
 * Named colour slots a preset can claim, so different shifts (Утро/День/Вечер/…)
 * read apart at a glance in the schedule instead of all sharing the category's
 * one blue. Only the *name* is shared — each app maps it to its own light/dark
 * values, since legibility is a per-theme concern.
 */
export const templateAccents = ["gold", "blue", "violet", "indigo", "teal", "green", "rose", "amber", "emerald"] as const;
export type TemplateAccent = (typeof templateAccents)[number];

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

/**
 * Русская подпись категории.
 *
 * Живёт здесь, потому что её просит сервер: письмо об изменении графика
 * называет вид записи словами, и человек должен прочитать в чате ровно то, что
 * увидит в клетке — там подпись это `title ?? categoryLabel(category)`.
 *
 * Мини-апп продолжает держать свою копию (`miniapp/src/categories.tsx`): он
 * намеренно не зависит от `@planer/shared` в рантайме. Копию сторожит
 * `miniapp/src/category-labels.test.ts` — он импортирует shared только в тесте.
 */
const CATEGORY_LABELS: Record<EntryCategory, string> = {
  shift: "Смена",
  vacation: "Отпуск",
  sick_leave: "Больничный",
  duty: "Дежурство",
  offsite: "Выездное мероприятие",
  business_trip: "Командировка",
  weekend_work: "Работа в выходной",
};

export function categoryLabel(category: EntryCategory): string {
  return CATEGORY_LABELS[category];
}
