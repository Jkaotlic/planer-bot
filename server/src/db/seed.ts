import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { shiftTemplates, type NewShiftTemplate } from "./schema";

const DEFAULT_TEMPLATES: NewShiftTemplate[] = [
  { name: "Утро", category: "shift", accent: "gold", start: "08:00", end: "17:00", fridayStart: "08:00", fridayEnd: "15:45", isLate: false, sendReminder: true, sortOrder: 0 },
  { name: "День", category: "shift", accent: "blue", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: false, sortOrder: 1 },
  { name: "Вечер", category: "shift", accent: "violet", start: "11:00", end: "20:00", fridayStart: "12:00", fridayEnd: "20:00", isLate: true, sendReminder: false, sortOrder: 2 },
  { name: "Ночь", category: "shift", accent: "indigo", start: "15:00", end: "23:00", fridayStart: "16:00", fridayEnd: "23:00", isLate: true, sendReminder: true, sortOrder: 3 },
  { name: "Дежурство · Поклонка", category: "duty", accent: "teal", location: "Поклонка", start: "09:00", end: "21:00", fridayStart: "09:00", fridayEnd: "21:00", isLate: false, sendReminder: true, sortOrder: 4 },
];

/**
 * Brings the built-in presets in line with the defaults above: inserts any that
 * are missing (matched by name) and backfills the presentation fields on ones
 * seeded before those columns existed. These presets have no edit UI, so the
 * defaults here stay authoritative for them.
 */
export function seedDefaultTemplates(db: Db): void {
  const existing = db.select().from(shiftTemplates).all();
  const byName = new Map(existing.map((t) => [t.name, t]));

  const missing = DEFAULT_TEMPLATES.filter((t) => !byName.has(t.name));
  if (missing.length > 0) db.insert(shiftTemplates).values(missing).run();

  for (const def of DEFAULT_TEMPLATES) {
    const row = byName.get(def.name);
    if (!row) continue;
    const location = def.location ?? null;
    if (row.accent === def.accent && row.category === def.category && row.location === location) continue;
    db.update(shiftTemplates)
      .set({ accent: def.accent, category: def.category, location })
      .where(eq(shiftTemplates.id, row.id))
      .run();
  }
}
