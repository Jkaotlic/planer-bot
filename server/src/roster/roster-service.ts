import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { employees, shifts, auditLog } from "../db/schema";
import { createEntrySchema } from "../http/entry-schema";
import type { DecodeResult, UnknownCell } from "./roster-codec";

export type PersonResolution =
  | { csvName: string; action: "rename"; employeeId: number }
  | { csvName: string; action: "create" };

export type ImportSummary = {
  employeesRenamed: number;
  employeesCreated: number;
  entriesInserted: number;
  unknowns: UnknownCell[];
};

export function applyRosterImport(
  db: Db,
  decoded: DecodeResult,
  resolutions: PersonResolution[],
  actorEmployeeId: number | null,
): ImportSummary {
  const byName = new Map(resolutions.map((r) => [r.csvName, r] as const));
  for (const p of decoded.perPerson) {
    if (!byName.has(p.name)) throw new Error(`нет сверки для «${p.name}»`);
  }

  return db.transaction((tx) => {
    let renamed = 0, created = 0, inserted = 0;
    for (const person of decoded.perPerson) {
      const res = byName.get(person.name)!;
      let employeeId: number;
      if (res.action === "rename") {
        // Rename in place — keeps telegramUserId, so reminders keep reaching them.
        tx.update(employees).set({ displayName: person.name }).where(eq(employees.id, res.employeeId)).run();
        employeeId = res.employeeId;
        renamed++;
      } else {
        employeeId = tx.insert(employees).values({ displayName: person.name }).returning().all()[0]!.id;
        created++;
      }
      for (const e of person.entries) {
        const parsed = createEntrySchema.safeParse({
          date: e.date, endDate: e.endDate, category: e.category, templateId: e.templateId,
          location: e.location, start: e.start, end: e.end, title: e.title, employeeId,
        });
        if (!parsed.success) {
          const msg = parsed.error.issues.map((i) => i.message).join("; ");
          throw new Error(`строка ${person.name}/${e.date} не прошла проверку: ${msg}`);
        }
        tx.insert(shifts).values(parsed.data).run();
        inserted++;
      }
    }
    tx.insert(auditLog).values({
      type: "roster_import",
      actorEmployeeId,
      payload: { employeesRenamed: renamed, employeesCreated: created, entriesInserted: inserted, unknowns: decoded.unknowns.length },
    }).run();
    return { employeesRenamed: renamed, employeesCreated: created, entriesInserted: inserted, unknowns: decoded.unknowns };
  });
}
