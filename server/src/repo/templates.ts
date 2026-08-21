import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { shiftTemplates, type ShiftTemplate } from "../db/schema";

export function listActiveTemplates(db: Db): ShiftTemplate[] {
  return db
    .select()
    .from(shiftTemplates)
    .where(eq(shiftTemplates.isActive, true))
    .orderBy(shiftTemplates.sortOrder)
    .all();
}

export function getTemplate(db: Db, id: number): ShiftTemplate | undefined {
  return db.select().from(shiftTemplates).where(eq(shiftTemplates.id, id)).get();
}

/** Ставит или снимает у вида смены признак «требует чек-лист». */
export function setTemplateRequiresChecklist(db: Db, id: number, requiresChecklist: boolean): void {
  db.update(shiftTemplates).set({ requiresChecklist }).where(eq(shiftTemplates.id, id)).run();
}
