import type { Db } from "./client";
import { shiftTemplates, type NewShiftTemplate } from "./schema";

const DEFAULT_TEMPLATES: NewShiftTemplate[] = [
  { name: "Утро", start: "08:00", end: "17:00", fridayStart: "08:00", fridayEnd: "15:45", isLate: false, sendReminder: true, sortOrder: 0 },
  { name: "День", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: false, sortOrder: 1 },
  { name: "Вечер", start: "11:00", end: "20:00", fridayStart: "12:00", fridayEnd: "20:00", isLate: true, sendReminder: false, sortOrder: 2 },
  { name: "Ночь", start: "15:00", end: "23:00", fridayStart: "16:00", fridayEnd: "23:00", isLate: true, sendReminder: true, sortOrder: 3 },
];

/** Insert the default presets once. No-op if any template already exists. */
export function seedDefaultTemplates(db: Db): void {
  const existing = db.select({ id: shiftTemplates.id }).from(shiftTemplates).limit(1).all();
  if (existing.length > 0) return;
  db.insert(shiftTemplates).values(DEFAULT_TEMPLATES).run();
}
