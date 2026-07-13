import { openDb, runMigrations, type Db } from "./client";

/** Fresh in-memory, fully-migrated db for a single test. */
export function makeTestDb(): Db {
  const { db } = openDb(":memory:");
  runMigrations(db);
  return db;
}
