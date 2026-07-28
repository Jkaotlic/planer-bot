import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { templatePool, templatePreference, employees } from "../db/schema";

/**
 * Who may take a kind of shift, and who asked for it.
 *
 * Both are per preset. An **empty pool means everyone** — that is what an
 * unconfigured preset looks like, and it is also why nobody ever needs
 * "excluding": the people who don't do Поклонка simply aren't in its pool.
 *
 * A preference is a soft tiebreak, never a filter: see `distributeFairly`, where
 * it sits between "fewest of this kind" and "fewest overall".
 */

export interface TemplateRoles {
  /** Employee ids allowed to take this preset. Empty = everyone. */
  pool: number[];
  /** employeeId -> weight (higher wins). Absent = didn't ask for it. */
  preference: Record<number, number>;
}

export function getTemplateRoles(db: Db, templateId: number): TemplateRoles {
  const pool = db
    .select({ employeeId: templatePool.employeeId })
    .from(templatePool)
    .where(eq(templatePool.templateId, templateId))
    .all()
    .map((row) => row.employeeId);

  const preference: Record<number, number> = {};
  for (const row of db
    .select({ employeeId: templatePreference.employeeId, weight: templatePreference.weight })
    .from(templatePreference)
    .where(eq(templatePreference.templateId, templateId))
    .all()) {
    preference[row.employeeId] = row.weight;
  }
  return { pool, preference };
}

/** Every preset's roles in one pass — what the distributor needs, without a query per slot. */
export function getAllTemplateRoles(db: Db): Map<number, TemplateRoles> {
  const out = new Map<number, TemplateRoles>();
  const roles = (templateId: number): TemplateRoles => {
    let entry = out.get(templateId);
    if (!entry) {
      entry = { pool: [], preference: {} };
      out.set(templateId, entry);
    }
    return entry;
  };
  for (const row of db.select().from(templatePool).all()) {
    roles(row.templateId).pool.push(row.employeeId);
  }
  for (const row of db.select().from(templatePreference).all()) {
    roles(row.templateId).preference[row.employeeId] = row.weight;
  }
  return out;
}

class UnknownEmployeesError extends Error {
  constructor(ids: number[]) {
    super(`неизвестные сотрудники: ${ids.join(", ")}`);
    this.name = "UnknownEmployeesError";
  }
}

/** Rejects ids that aren't active workers, so a stale screen can't write a pool
 *  pointing at somebody archived — or at nobody at all. */
function assertActive(db: Db, ids: number[]): void {
  if (ids.length === 0) return;
  const active = new Set(
    db
      .select({ id: employees.id })
      .from(employees)
      .where(and(inArray(employees.id, ids), eq(employees.isActive, true)))
      .all()
      .map((row) => row.id),
  );
  const bad = ids.filter((id) => !active.has(id));
  if (bad.length > 0) throw new UnknownEmployeesError([...new Set(bad)]);
}

/**
 * Replaces a preset's roles wholesale. Replace rather than patch: the editor
 * always sends the full picture, and a diff would leave a half-applied pool
 * behind if one row failed.
 */
export function setTemplateRoles(db: Db, templateId: number, roles: TemplateRoles): TemplateRoles {
  const pool = [...new Set(roles.pool)];
  const preferred = Object.entries(roles.preference)
    .map(([employeeId, weight]) => ({ employeeId: Number(employeeId), weight }))
    // Weight 0 means "no longer asked for it" — the same as not being in the table.
    .filter((row) => Number.isInteger(row.employeeId) && row.weight > 0);

  assertActive(db, [...new Set([...pool, ...preferred.map((row) => row.employeeId)])]);

  return db.transaction((tx) => {
    tx.delete(templatePool).where(eq(templatePool.templateId, templateId)).run();
    tx.delete(templatePreference).where(eq(templatePreference.templateId, templateId)).run();
    for (const employeeId of pool) {
      tx.insert(templatePool).values({ templateId, employeeId }).run();
    }
    for (const row of preferred) {
      tx.insert(templatePreference).values({ templateId, employeeId: row.employeeId, weight: row.weight }).run();
    }
    return { pool, preference: Object.fromEntries(preferred.map((row) => [row.employeeId, row.weight])) };
  });
}

export { UnknownEmployeesError };
