import type { Db } from "./client";
import { shiftTemplates, type NewShiftTemplate } from "./schema";

const DEFAULT_TEMPLATES: NewShiftTemplate[] = [
  { name: "Утро", category: "shift", start: "08:00", end: "17:00", fridayStart: "08:00", fridayEnd: "15:45", isLate: false, sendReminder: true, sortOrder: 0 },
  { name: "День", category: "shift", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: false, sortOrder: 1 },
  { name: "Вечер", category: "shift", start: "11:00", end: "20:00", fridayStart: "12:00", fridayEnd: "20:00", isLate: true, sendReminder: false, sortOrder: 2 },
  { name: "Ночь", category: "shift", start: "15:00", end: "23:00", fridayStart: "16:00", fridayEnd: "23:00", isLate: true, sendReminder: true, sortOrder: 3 },
  { name: "Дежурство · Поклонка", category: "duty", location: "Поклонка", start: "09:00", end: "21:00", fridayStart: "09:00", fridayEnd: "21:00", isLate: false, sendReminder: true, sortOrder: 4 },
];

/** Insert any default presets that aren't present yet (matched by name), so
 * newly-added defaults (e.g. a new duty preset) reach an already-seeded DB. */
export function seedDefaultTemplates(db: Db): void {
  const existingNames = new Set(db.select({ name: shiftTemplates.name }).from(shiftTemplates).all().map((r) => r.name));
  const missing = DEFAULT_TEMPLATES.filter((t) => !existingNames.has(t.name));
  if (missing.length > 0) db.insert(shiftTemplates).values(missing).run();
}
