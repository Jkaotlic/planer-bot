import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { employees, shifts, auditLog } from "../db/schema";
import { createEntrySchema } from "../http/entry-schema";
import { listActive } from "../repo/employees";
import { listActiveTemplates } from "../repo/templates";
import { listShiftsOverlapping } from "../repo/shifts";
import { datesInRange, serializeRosterCsv, encodeEntryCode, NON_WORKING_CODE, type DecodeResult, type UnknownCell } from "./roster-codec";

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
    for (const [index, person] of decoded.perPerson.entries()) {
      const res = byName.get(person.name)!;
      let employeeId: number;
      if (res.action === "rename") {
        // Rename in place — keeps telegramUserId, so reminders keep reaching them.
        tx.update(employees).set({ displayName: person.name, rosterOrder: index }).where(eq(employees.id, res.employeeId)).run();
        employeeId = res.employeeId;
        renamed++;
      } else {
        employeeId = tx.insert(employees).values({ displayName: person.name, rosterOrder: index }).returning().all()[0]!.id;
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

/** Rebuild the roster matrix for [from, to]: one row per active worker, each cell
 *  the reverse of decode. No BOM — the download route adds it (like payroll.csv). */
export function buildRosterCsv(db: Db, from: string, to: string): string {
  const dates = datesInRange(from, to);
  // Preserve the imported file's row order (nulls — never imported — sort last);
  // id is a stable tiebreak for people who share a rosterOrder (or both lack one).
  const workers = [...listActive(db)].sort(
    (a, b) => (a.rosterOrder ?? Number.MAX_SAFE_INTEGER) - (b.rosterOrder ?? Number.MAX_SAFE_INTEGER) || a.id - b.id,
  );
  const rosterShifts = listShiftsOverlapping(db, from, to);
  const templatesById = new Map(listActiveTemplates(db).map((t) => [t.id, t] as const));
  const rows = workers.map((w) => ({
    name: w.displayName,
    codes: dates.map((date) => {
      const covering = rosterShifts.find((s) => s.employeeId === w.id && s.date <= date && (s.endDate ?? s.date) >= date);
      return covering ? encodeEntryCode(covering, templatesById) : NON_WORKING_CODE;
    }),
  }));
  return serializeRosterCsv(dates, rows);
}
