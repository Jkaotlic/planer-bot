import type Database from "better-sqlite3";
import { openDb, runMigrations, type Db } from "./client";

/** Fresh in-memory, fully-migrated db for a single test. */
export function makeTestDb(): Db {
  const { db, sqlite } = openDb(":memory:");
  runMigrations(db, sqlite);
  return db;
}

/**
 * Сколько раз за `run` сервер прочитал одного сотрудника по id (`getEmployeeById`).
 * Тесты на N+1 сравнивают это число на одной и на многих строках: если оно растёт
 * вместе со строками — имя берут запросом на строку, а не картой.
 */
export async function countEmployeeByIdLookups(db: Db, run: () => unknown): Promise<number> {
  const sqlite = (db as unknown as { $client: Database.Database }).$client;
  const prepare = sqlite.prepare;
  let count = 0;
  sqlite.prepare = function (this: Database.Database, source: string) {
    if (/from "employees" where "employees"\."id" = \?/.test(source)) count += 1;
    return prepare.call(this, source);
  } as typeof sqlite.prepare;
  try {
    await run();
  } finally {
    sqlite.prepare = prepare;
  }
  return count;
}
