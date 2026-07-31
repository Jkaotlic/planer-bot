import { and, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { employees, shifts, auditLog, swapRequests, reminderLog, weekendAssignments } from "../db/schema";
import { createEntrySchema } from "../http/entry-schema";
import { listActive, getEmployeeById } from "../repo/employees";
import { listActiveTemplates } from "../repo/templates";
import { listShiftsOverlapping } from "../repo/shifts";
import { swapAuditPayload, type SwapAuditPayload } from "../util/message-lines";
import { cellKey, crowdedCells, datesInRange, serializeRosterCsv, encodeEntryCode, NON_WORKING_CODE, UNENCODABLE_CODE, type DecodeResult, type UnknownCell } from "./roster-codec";

export type PersonResolution =
  | { csvName: string; action: "rename"; employeeId: number }
  | { csvName: string; action: "create" };

export type ImportSummary = {
  employeesRenamed: number;
  employeesCreated: number;
  entriesInserted: number;
  entriesDeleted: number;
  cellsPreserved: number;
  /** Pending swaps the overwrite invalidated — the admin replaced a month people
   *  had open requests on, which is worth a number rather than silence. */
  swapsExpired: number;
  unknowns: UnknownCell[];
};

/** The summary plus the material only the caller can act on: who to tell that
 *  their swap is off, described while the shifts it names still existed. */
export type ImportResult = ImportSummary & { expiredSwaps: SwapAuditPayload[] };

export interface ApplyOptions {
  /** Replace what is already in the span instead of refusing. */
  overwrite?: boolean;
  /** The span the file describes. Defaults to the decoded entries' own extent, which
   *  is not the same thing: a month whose CSV is entirely 'holiday' decodes to no
   *  entries at all, yet still means "this month is empty" and must clear it. */
  span?: { from: string; to: string };
}

/** Thrown when the target span already holds entries and the caller didn't ask to
 *  overwrite. Carries the numbers the admin screen needs to offer that choice. */
export class RosterImportConflictError extends Error {
  constructor(readonly existingCount: number, readonly from: string, readonly to: string) {
    super(`в базе уже есть ${existingCount} записей за ${from}..${to} — импорт отменён`);
    this.name = "RosterImportConflictError";
  }
}

export function applyRosterImport(
  db: Db,
  decoded: DecodeResult,
  resolutions: PersonResolution[],
  actorEmployeeId: number | null,
  options: ApplyOptions = {},
): ImportResult {
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

  // The span the import governs. An explicit span (the CSV's own header dates) wins;
  // otherwise fall back to the decoded entries' extent.
  const allEntries = decoded.perPerson.flatMap((p) => p.entries);
  const importSpan = options.span ?? (allEntries.length === 0 ? null : {
    from: allEntries.reduce((m, e) => (e.date < m ? e.date : m), allEntries[0]!.date),
    to: allEntries.reduce((m, e) => { const d = e.endDate ?? e.date; return d > m ? d : m; }, allEntries[0]!.endDate ?? allEntries[0]!.date),
  });

  const templatesById = new Map(listActiveTemplates(db).map((t) => [t.id, t] as const));

  return db.transaction((tx) => {
    let deleted = 0;
    let expiredSwaps: SwapAuditPayload[] = [];
    // Re-import guard: a second pass over an already-imported month must never
    // silently double every entry (Stage 3 reads these counts for fairness proposals).
    // With `overwrite` the admin has explicitly chosen to replace it instead.
    if (importSpan) {
      const existing = tx.select().from(shifts)
        .where(and(
          lte(shifts.date, importSpan.to),
          gte(sql`coalesce(${shifts.endDate}, ${shifts.date})`, importSpan.from),
        )).all();

      if (existing.length > 0 && !options.overwrite) {
        throw new RosterImportConflictError(existing.length, importSpan.from, importSpan.to);
      }

      if (existing.length > 0) {
        // Only entries the roster vocabulary can express are the import's to replace.
        // Weekend work and one-off custom times export as '?' — the file cannot
        // recreate them, so overwriting must leave them exactly where they are. Same
        // for a day carrying two entries: the export writes '?' over the whole cell,
        // so neither half is the file's to delete.
        //
        // Same rule one level up, about rows rather than cells: the export writes a
        // row per ACTIVE worker, so an archived person's past month is not in the
        // file at all. The file has no way to say «he worked that Tuesday», so it has
        // no standing to say he didn't.
        const crowded = crowdedCells(existing);
        const inTheGrid = new Set(listActive(db).map((employee) => employee.id));
        // And the cells the FILE marks '?'. Both admin screens promise «клеток "?" —
        // N, их импорт не тронет», so a '?' typed by hand has to mean it too, not
        // just one written by the export.
        const spared = new Set(
          decoded.preserved.flatMap((cell) => {
            const res = byName.get(cell.name);
            return res?.action === "rename" ? [cellKey(res.employeeId, cell.date)] : [];
          }),
        );
        const untouchable = (s: { employeeId: number | null; date: string; endDate: string | null }) =>
          datesInRange(s.date, s.endDate ?? s.date)
            .some((d) => crowded.has(cellKey(s.employeeId, d)) || spared.has(cellKey(s.employeeId, d)));
        const encodable = existing.filter(
          (s) =>
            s.employeeId != null && inTheGrid.has(s.employeeId) &&
            encodeEntryCode(s, templatesById) !== UNENCODABLE_CODE &&
            !untouchable(s),
        );

        // A range that starts before or ends after the span reaches outside the file's
        // authority: deleting it would destroy a month the CSV never described, and
        // keeping it would double-cover the days it shares. Refuse, and say which.
        const straddling = encodable.filter((s) => s.date < importSpan.from || (s.endDate ?? s.date) > importSpan.to);
        if (straddling.length > 0) {
          const s = straddling[0]!;
          const who = s.employeeId != null ? (getEmployeeById(db, s.employeeId)?.displayName ?? `#${s.employeeId}`) : "без сотрудника";
          throw new Error(
            `запись «${who}» ${s.date}..${s.endDate ?? s.date} выходит за пределы ${importSpan.from}..${importSpan.to} ` +
              `— перезапись отменена, поправьте её вручную и повторите (таких записей: ${straddling.length})`,
          );
        }

        const ids = encodable.map((s) => s.id);
        if (ids.length > 0) {
          // Same foreign-key cleanup deleteShift() does, batched — it opens its own
          // transaction, which cannot nest inside this one. Same rule about swaps
          // too: a file replacing a month doesn't erase what people arranged on it.
          // Describe them first — a moment later their shifts are gone and the line
          // would read "смену".
          const touched = or(inArray(swapRequests.fromShiftId, ids), inArray(swapRequests.toShiftId, ids));
          const stillPending = tx.select().from(swapRequests)
            .where(and(eq(swapRequests.status, "pending"), touched)).all();
          expiredSwaps = stillPending.map((r) => swapAuditPayload(db, r));
          if (stillPending.length > 0) {
            tx.update(swapRequests).set({ status: "expired", resolvedAt: new Date() })
              .where(inArray(swapRequests.id, stillPending.map((r) => r.id))).run();
          }
          tx.update(swapRequests).set({ fromShiftId: null }).where(inArray(swapRequests.fromShiftId, ids)).run();
          tx.update(swapRequests).set({ toShiftId: null }).where(inArray(swapRequests.toShiftId, ids)).run();
          tx.delete(reminderLog).where(inArray(reminderLog.shiftId, ids)).run();
          tx.update(weekendAssignments).set({ shiftId: null }).where(inArray(weekendAssignments.shiftId, ids)).run();
          tx.delete(shifts).where(inArray(shifts.id, ids)).run();
        }
        deleted = ids.length;
      }
    }

    let renamed = 0, created = 0, inserted = 0;
    /** The file's people, in the file's row order — the roster's own order. */
    const orderedIds: number[] = [];
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
      orderedIds.push(employeeId);
      for (const e of person.entries) {
        // An unread cell is a faithful record of a file, not user input, so it does
        // not go through `createEntrySchema` — that schema rightly insists a work
        // entry has clock times, and this is the one case where we have none and
        // must not invent any. Nothing else may create these: see the API test.
        if (e.unrecognisedCode) {
          tx.insert(shifts).values({
            date: e.date, category: "shift", employeeId, unrecognisedCode: e.unrecognisedCode,
          }).run();
          inserted++;
          continue;
        }
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
    // The loop above numbered the file's people 0..n-1. Anybody active who is NOT
    // in the file still holds whatever number they had, which now collides with
    // one of those — two people showing as «2», and the list order falling back to
    // id. Put the file's roster first, in the file's order, and everyone else
    // after it, keeping their relative order.
    const fileIds = new Set(orderedIds);
    const others = tx
      .select()
      .from(employees)
      .where(eq(employees.isActive, true))
      .orderBy(
        sql`case when ${employees.rosterOrder} is null then 1 else 0 end`,
        employees.rosterOrder,
        employees.id,
      )
      .all()
      .filter((employee) => !fileIds.has(employee.id));
    others.forEach((employee, index) => {
      const next = decoded.perPerson.length + index;
      if (employee.rosterOrder !== next) {
        tx.update(employees).set({ rosterOrder: next }).where(eq(employees.id, employee.id)).run();
      }
    });

    tx.insert(auditLog).values({
      type: "roster_import",
      actorEmployeeId,
      payload: {
        employeesRenamed: renamed, employeesCreated: created, entriesInserted: inserted,
        entriesDeleted: deleted, overwrite: options.overwrite === true,
        cellsPreserved: decoded.preserved.length, unknowns: decoded.unknowns.length,
        swapsExpired: expiredSwaps.length,
        from: importSpan?.from ?? null, to: importSpan?.to ?? null,
      },
    }).run();
    return {
      employeesRenamed: renamed, employeesCreated: created, entriesInserted: inserted,
      entriesDeleted: deleted, cellsPreserved: decoded.preserved.length, unknowns: decoded.unknowns,
      swapsExpired: expiredSwaps.length, expiredSwaps,
    };
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
  const crowded = crowdedCells(rosterShifts);
  const rows = workers.map((w) => ({
    name: w.displayName,
    codes: dates.map((date) => {
      // A day with two entries has no single code. Writing the first one would
      // report half the day and, on the way back, delete the other half.
      if (crowded.has(cellKey(w.id, date))) return UNENCODABLE_CODE;
      const covering = rosterShifts.find((s) => s.employeeId === w.id && s.date <= date && (s.endDate ?? s.date) >= date);
      return covering ? encodeEntryCode(covering, templatesById) : NON_WORKING_CODE;
    }),
  }));
  return serializeRosterCsv(dates, rows);
}
