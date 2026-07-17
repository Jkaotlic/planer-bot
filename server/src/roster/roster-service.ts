import { and, eq, gte, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import { employees, shifts, auditLog } from "../db/schema";
import { createEntrySchema } from "../http/entry-schema";
import { listActive, getEmployeeById } from "../repo/employees";
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

  // Resolve every rename target up front — a Stage 2B reconcile UI sits directly on
  // this primitive, so a bogus, archived, or double-claimed id must not pass silently.
  const claimedBy = new Map<number, string>(); // employeeId -> csvName that first claimed it
  for (const res of resolutions) {
    if (res.action !== "rename") continue;
    const employee = getEmployeeById(db, res.employeeId);
    if (!employee) {
      throw new Error(`сверка «${res.csvName}» указывает на несуществующего сотрудника #${res.employeeId}`);
    }
    if (!employee.isActive) {
      throw new Error(`сверка «${res.csvName}» указывает на архивного сотрудника «${employee.displayName}» — восстановите его или отмените сверку`);
    }
    const other = claimedBy.get(res.employeeId);
    if (other) {
      throw new Error(`сверки «${other}» и «${res.csvName}» указывают на одного и того же сотрудника #${res.employeeId}`);
    }
    claimedBy.set(res.employeeId, res.csvName);
  }

  // The imported span, across every decoded entry (endDate for multi-day runs).
  const allEntries = decoded.perPerson.flatMap((p) => p.entries);
  const importSpan = allEntries.length === 0 ? null : {
    from: allEntries.reduce((m, e) => (e.date < m ? e.date : m), allEntries[0]!.date),
    to: allEntries.reduce((m, e) => { const d = e.endDate ?? e.date; return d > m ? d : m; }, allEntries[0]!.endDate ?? allEntries[0]!.date),
  };

  return db.transaction((tx) => {
    // Re-import guard: a second pass over an already-imported month must error, not
    // silently double every entry (Stage 3 reads these counts for fairness proposals).
    if (importSpan) {
      const existing = tx.select().from(shifts)
        .where(and(gte(shifts.date, importSpan.from), lte(shifts.date, importSpan.to))).all();
      if (existing.length > 0) {
        throw new Error(
          `в базе уже есть ${existing.length} записей за ${importSpan.from}..${importSpan.to} — импорт отменён (очистите период или импортируйте другой месяц)`,
        );
      }
    }

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
