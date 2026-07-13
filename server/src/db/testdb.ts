import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";
import type { Db } from "./client";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Fresh in-memory, fully-migrated db for a single test. */
export function makeTestDb(): Db {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema, casing: "snake_case" });
  migrate(db, { migrationsFolder });
  return db;
}
