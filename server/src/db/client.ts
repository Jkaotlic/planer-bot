import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export function openDb(path: string): { db: Db; sqlite: Database.Database } {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema, casing: "snake_case" });
  return { db, sqlite };
}

export function runMigrations(db: Db, sqlite: Database.Database): void {
  // A migration that recreates an FK-referenced table (SQLite can't drop NOT NULL
  // in place) must run with FK enforcement OFF. The `PRAGMA foreign_keys=OFF` inside
  // the migration file is a no-op because migrate() runs in a transaction, so toggle
  // it on the raw connection here, around the whole migrate() call.
  //
  // Note: `db.$client` would be the more direct way to reach the raw connection, but
  // the `Db` alias (`BetterSQLite3Database<typeof schema>`) doesn't carry the `$client`
  // member — that's only present on the ad-hoc intersection type `drizzle()` returns —
  // so we thread the raw handle through from `openDb` instead.
  sqlite.pragma("foreign_keys = OFF");
  try {
    migrate(db, { migrationsFolder });
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
}
