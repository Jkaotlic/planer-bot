import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client";

/** Any table with an integer `id` and a text `status` — handovers, swaps, weekend slots. */
type StatusTable = SQLiteTable & { id: SQLiteColumn; status: SQLiteColumn };

/**
 * Move a row's status only if it is still in one of the `from` states; true for the caller that moved it.
 *
 * The pattern this replaces — read the status, await Telegram, then write — let two
 * paths both believe they won: «Не могу» answered the tap while the tick fanned the same
 * handover, and the team got the fan-out twice (H8). One conditional UPDATE is atomic
 * in SQLite and this process has one connection, so exactly one caller gets `true`, and
 * only that caller sends anything. Not a transaction around the send on purpose:
 * better-sqlite3 transactions are synchronous and cannot span an await.
 *
 * `guard` narrows the WHERE further for a state the status alone does not tell — a
 * handover is `fanned` both after a real fan-out and after an escalation that wrote to
 * nobody, and only the second may still be fanned.
 */
export function transition<T extends Record<string, unknown>>(
  db: Db,
  table: StatusTable,
  id: number,
  from: readonly string[],
  set: Partial<T> & { status: string },
  guard?: SQL,
): boolean {
  if (from.length === 0) return false;
  return (
    db
      .update(table)
      .set(set as never)
      .where(and(eq(table.id, id), inArray(table.status, [...from]), guard))
      .run().changes > 0
  );
}
