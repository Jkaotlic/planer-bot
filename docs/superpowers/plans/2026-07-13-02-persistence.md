# Persistence Layer — Implementation Plan (Plan 2 of ~8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `@planer/server` persistence layer — Drizzle/SQLite schema for every entity, migrations, an idempotent preset seed, a typed config loader, and a repository (data-access) layer with a real end-to-end SQLite integration test.

**Architecture:** Adds the `server` workspace to the monorepo. This plan is data-only — NO HTTP, NO Telegram yet. It imports domain types from `@planer/shared` (built in Plan 1) and reuses them as Drizzle column `$type`s so the DB rows and the domain types stay in lock-step. Integration tests run against an in-memory SQLite database migrated from the generated SQL.

**Tech Stack:** Drizzle ORM (`drizzle-orm/better-sqlite3`), `better-sqlite3`, `drizzle-kit`, Zod. Vitest.

Design spec: `docs/superpowers/specs/2026-07-13-shift-planner-telegram-bot-design.md` (§6 data model, §7 flows).

## Global Constraints

- **Runtime:** Node.js ≥ 20; deploy target Raspberry Pi 4 (arm64). `better-sqlite3` is a native module — dev (macOS arm64, Node 22) uses prebuilt binaries; the Pi needs `python3` + `build-essential` available at deploy time if no prebuilt matches (deploy-time note, not this plan).
- **Modules:** ESM; `moduleResolution: "Bundler"`; extensionless relative imports.
- **TypeScript:** `strict: true`; no `any`.
- **Drizzle casing:** use `casing: "snake_case"` in BOTH `drizzle.config.ts` and every runtime `drizzle(...)` call, so camelCase schema keys map to snake_case DB columns. Schema files use bare column builders (`text()`, `integer()`), never hand-written snake_case names.
- **Timestamps:** stored as `integer({ mode: "timestamp" })` (unix seconds); `created_at`-style columns default to `sql\`(unixepoch())\``.
- **Shift wall-clock fields** (`date`, `start`, `end`) stay `text` — they are timezone-agnostic wall-clock strings owned by `@planer/shared`, never DB timestamps.
- **Reuse shared types:** enum-ish text columns use `.$type<...>()` with the type imported from `@planer/shared` (e.g. `SwapStatus`).
- **Purity boundary:** `@planer/shared` stays pure; all I/O lives in `@planer/server`.
- **Commits:** one per task, conventional-commits style.

## File Structure

```
planer-bot/
├── package.json                 # add "server" to workspaces
├── drizzle.config.ts            # drizzle-kit config (sqlite, snake_case)
└── server/
    ├── package.json             # @planer/server; deps: drizzle-orm, better-sqlite3, zod, @planer/shared
    ├── tsconfig.json
    ├── drizzle/                 # generated migration SQL (committed)
    └── src/
        ├── config.ts            # loadConfig(env) → typed Config (zod)
        ├── db/
        │   ├── schema.ts        # all Drizzle tables + inferred row types
        │   ├── client.ts        # openDb(path) → { db, sqlite }, runMigrations(db)
        │   ├── seed.ts          # seedDefaultTemplates(db) (idempotent)
        │   └── testdb.ts        # makeTestDb() → in-memory migrated db (test helper)
        └── repo/
            ├── employees.ts     # employee data access
            ├── templates.ts     # template data access
            └── shifts.ts        # shift data access
```

Each `repo/*.ts` and `config.ts`/`seed.ts` gets a colocated `*.test.ts`.

---

### Task 1: Server workspace + Drizzle deps + config file

**Files:**
- Modify: `package.json` (root — add `"server"` to `workspaces`)
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `drizzle.config.ts`
- Test: `server/src/smoke.test.ts`

**Interfaces:**
- Consumes: the Plan-1 monorepo (`@planer/shared` workspace, root Vitest).
- Produces: the `@planer/server` workspace; `npm test` still green; `npx drizzle-kit` resolvable.

- [ ] **Step 1: Write the failing test**

Create `server/src/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";

describe("server workspace smoke", () => {
  it("has its dependencies wired", () => {
    expect(typeof z.object).toBe("function");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `@planer/server`'s test can't resolve `zod` (workspace/deps not set up yet).

- [ ] **Step 3: Create the workspace files**

Edit root `package.json` — add `"server"` to the `workspaces` array so it reads `"workspaces": ["shared", "server"]`.

Create `server/package.json`:

```json
{
  "name": "@planer/server",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "@planer/shared": "*",
    "zod": "^3.23.0"
  }
}
```

(Drizzle/better-sqlite3 deps are added by npm in Step 4 so their versions resolve to the current compatible set rather than stale pins.)

Create `server/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "include": ["src"]
}
```

Create `drizzle.config.ts` (repo root):

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./server/src/db/schema.ts",
  out: "./server/drizzle",
  casing: "snake_case",
  dbCredentials: { url: process.env.DATABASE_URL ?? "./data/planer.db" },
});
```

- [ ] **Step 4: Install dependencies into the server workspace**

Run:
```bash
npm install drizzle-orm better-sqlite3 -w @planer/server
npm install -D drizzle-kit @types/better-sqlite3 -w @planer/server
```
Expected: current compatible versions are added to `server/package.json` and the root lockfile; `better-sqlite3` installs a prebuilt native binary. If `better-sqlite3` cannot find a prebuilt binary and fails to compile, STOP and report BLOCKED (environment issue).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — both workspaces' suites green (Plan-1 `shared` tests + this smoke test).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json server/package.json server/tsconfig.json drizzle.config.ts server/src/smoke.test.ts
git commit -m "chore(server): scaffold @planer/server workspace with drizzle + better-sqlite3"
```

---

### Task 2: Database schema

**Files:**
- Create: `server/src/db/schema.ts`
- Test: `server/src/db/schema.test.ts`

**Interfaces:**
- Consumes: `SwapStatus` from `@planer/shared`; `sqliteTable`, `integer`, `text`, `uniqueIndex` from `drizzle-orm/sqlite-core`; `sql` from `drizzle-orm`.
- Produces: tables `employees`, `shiftTemplates`, `shifts`, `swapRequests`, `reminderLog`, `auditLog`, and inferred types `Employee = typeof employees.$inferSelect`, `NewEmployee = typeof employees.$inferInsert` (and the same `$inferSelect`/`$inferInsert` pair for each table).

- [ ] **Step 1: Write the failing test**

Create `server/src/db/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { employees, shifts, shiftTemplates, swapRequests, reminderLog, auditLog } from "./schema";
import { getTableConfig } from "drizzle-orm/sqlite-core";

describe("schema", () => {
  it("declares all six tables with expected sqlite names", () => {
    expect(getTableConfig(employees).name).toBe("employees");
    expect(getTableConfig(shiftTemplates).name).toBe("shift_templates");
    expect(getTableConfig(shifts).name).toBe("shifts");
    expect(getTableConfig(swapRequests).name).toBe("swap_requests");
    expect(getTableConfig(reminderLog).name).toBe("reminder_log");
    expect(getTableConfig(auditLog).name).toBe("audit_log");
  });

  it("maps camelCase keys to snake_case columns", () => {
    const cols = getTableConfig(employees).columns.map((c) => c.name);
    expect(cols).toContain("telegram_user_id");
    expect(cols).toContain("display_name");
    expect(cols).toContain("prep_buffer_min");
  });

  it("declares one index on reminder_log (uniqueness verified in the migration SQL, Task 3)", () => {
    expect(getTableConfig(reminderLog).indexes.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./schema`.

- [ ] **Step 3: Write the implementation**

Create `server/src/db/schema.ts`:

```ts
import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { SwapStatus } from "@planer/shared";

const createdAt = () =>
  integer({ mode: "timestamp" }).notNull().default(sql`(unixepoch())`);

export const employees = sqliteTable("employees", {
  id: integer().primaryKey({ autoIncrement: true }),
  telegramUserId: integer().unique(),
  tgUsername: text(),
  displayName: text().notNull(),
  phone: text(),
  isAdmin: integer({ mode: "boolean" }).notNull().default(false),
  isActive: integer({ mode: "boolean" }).notNull().default(true),
  remindersEnabled: integer({ mode: "boolean" }).notNull().default(true),
  prepBufferMin: integer().notNull().default(60),
  inviteToken: text().unique(),
  createdAt: createdAt(),
});

export const shiftTemplates = sqliteTable("shift_templates", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  start: text().notNull(),
  end: text().notNull(),
  fridayStart: text(),
  fridayEnd: text(),
  isLate: integer({ mode: "boolean" }).notNull().default(false),
  sendReminder: integer({ mode: "boolean" }).notNull().default(false),
  sortOrder: integer().notNull().default(0),
  isActive: integer({ mode: "boolean" }).notNull().default(true),
});

export const shifts = sqliteTable("shifts", {
  id: integer().primaryKey({ autoIncrement: true }),
  date: text().notNull(),
  start: text().notNull(),
  end: text().notNull(),
  templateId: integer().references(() => shiftTemplates.id),
  title: text(),
  employeeId: integer().references(() => employees.id),
  note: text(),
  createdAt: createdAt(),
  updatedAt: createdAt(),
});

export const swapRequests = sqliteTable("swap_requests", {
  id: integer().primaryKey({ autoIncrement: true }),
  fromEmployeeId: integer().notNull().references(() => employees.id),
  fromShiftId: integer().notNull().references(() => shifts.id),
  toEmployeeId: integer().notNull().references(() => employees.id),
  toShiftId: integer().notNull().references(() => shifts.id),
  status: text().$type<SwapStatus>().notNull().default("pending"),
  message: text(),
  createdAt: createdAt(),
  resolvedAt: integer({ mode: "timestamp" }),
});

export const reminderLog = sqliteTable(
  "reminder_log",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    shiftId: integer().notNull().references(() => shifts.id),
    kind: text().notNull(),
    sentAt: createdAt(),
  },
  (t) => [uniqueIndex("reminder_shift_kind").on(t.shiftId, t.kind)],
);

export const auditLog = sqliteTable("audit_log", {
  id: integer().primaryKey({ autoIncrement: true }),
  type: text().notNull(),
  actorEmployeeId: integer().references(() => employees.id),
  payload: text({ mode: "json" }).notNull(),
  createdAt: createdAt(),
});

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type ShiftTemplate = typeof shiftTemplates.$inferSelect;
export type NewShiftTemplate = typeof shiftTemplates.$inferInsert;
export type Shift = typeof shifts.$inferSelect;
export type NewShift = typeof shifts.$inferInsert;
export type SwapRequest = typeof swapRequests.$inferSelect;
export type NewSwapRequest = typeof swapRequests.$inferInsert;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `schema` tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/db/schema.ts server/src/db/schema.test.ts
git commit -m "feat(server): drizzle schema for all entities"
```

---

### Task 3: Generate the initial migration

**Files:**
- Create: `server/drizzle/**` (generated SQL + meta — commit all of it)

**Interfaces:**
- Consumes: `server/src/db/schema.ts`, `drizzle.config.ts`.
- Produces: a committed migrations folder that `migrate()` (Task 4) applies.

This task is a generator run, not TDD — its "test" is that the SQL is generated and contains every table.

- [ ] **Step 1: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: prints that it created `server/drizzle/0000_*.sql` plus `server/drizzle/meta/`.

- [ ] **Step 2: Verify the SQL covers all tables**

Run: `grep -c "CREATE TABLE" server/drizzle/0000_*.sql`
Expected: `6` (employees, shift_templates, shifts, swap_requests, reminder_log, audit_log).

Run: `grep -c "CREATE UNIQUE INDEX" server/drizzle/0000_*.sql`
Expected: at least `1` (the `reminder_shift_kind` index; plus unique constraints may appear inline).

- [ ] **Step 3: Commit**

```bash
git add server/drizzle
git commit -m "feat(server): initial migration for schema"
```

---

### Task 4: DB client + migrations runner + test helper

**Files:**
- Create: `server/src/db/client.ts`
- Create: `server/src/db/testdb.ts`
- Test: `server/src/db/client.test.ts`

**Interfaces:**
- Consumes: `drizzle`, `migrate` from `drizzle-orm/better-sqlite3`(`/migrator`), `Database` from `better-sqlite3`, the schema module.
- Produces:
  - `openDb(path: string): { db: BetterSQLite3Database<typeof schema>; sqlite: Database.Database }` — opens the file, sets `PRAGMA journal_mode = WAL` and `foreign_keys = ON`, returns a Drizzle db (with `{ schema, casing: "snake_case" }`).
  - `runMigrations(db): void` — applies `server/drizzle`.
  - `makeTestDb(): BetterSQLite3Database<typeof schema>` (in `testdb.ts`) — an in-memory db, migrated, ready for tests.

- [ ] **Step 1: Write the failing test**

Create `server/src/db/client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "./testdb";
import { employees } from "./schema";

describe("db client", () => {
  it("migrates an in-memory db so tables are usable", () => {
    const db = makeTestDb();
    const inserted = db.insert(employees).values({ displayName: "Аня" }).returning().all();
    expect(inserted[0]!.id).toBeGreaterThan(0);
    expect(inserted[0]!.displayName).toBe("Аня");
    expect(inserted[0]!.isActive).toBe(true); // default applied
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./testdb`.

- [ ] **Step 3: Write the implementation**

Create `server/src/db/client.ts`:

```ts
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

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder });
}
```

Create `server/src/db/testdb.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — the in-memory db migrates and the insert returns a row with defaults applied.

- [ ] **Step 5: Commit**

```bash
git add server/src/db/client.ts server/src/db/testdb.ts server/src/db/client.test.ts
git commit -m "feat(server): sqlite client, migrations runner, in-memory test db"
```

---

### Task 5: Config loader

**Files:**
- Create: `server/src/config.ts`
- Test: `server/src/config.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces: `loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Config` where
  `Config = { botToken: string; adminTelegramIds: number[]; teamTz: string; databaseUrl: string; jwtSecret: string; publicUrl: string }`.
  Throws a descriptive error listing missing/invalid vars. `TEAM_TZ` defaults to `"Europe/Moscow"`; `DATABASE_URL` defaults to `"./data/planer.db"`. `ADMIN_TELEGRAM_IDS` parses a comma-separated list of integers.

- [ ] **Step 1: Write the failing test**

Create `server/src/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "./config";

const base = {
  BOT_TOKEN: "123:abc",
  ADMIN_TELEGRAM_IDS: "111, 222",
  JWT_SECRET: "s3cret-value-long-enough",
  PUBLIC_URL: "https://smeny.keenetic.pro",
};

describe("loadConfig", () => {
  it("parses a valid env with defaults", () => {
    const cfg = loadConfig(base);
    expect(cfg.adminTelegramIds).toEqual([111, 222]);
    expect(cfg.teamTz).toBe("Europe/Moscow"); // default
    expect(cfg.databaseUrl).toBe("./data/planer.db"); // default
    expect(cfg.botToken).toBe("123:abc");
  });

  it("honors an explicit TEAM_TZ", () => {
    expect(loadConfig({ ...base, TEAM_TZ: "Asia/Yekaterinburg" }).teamTz).toBe("Asia/Yekaterinburg");
  });

  it("throws when a required var is missing", () => {
    const { BOT_TOKEN, ...rest } = base;
    expect(() => loadConfig(rest)).toThrow(/BOT_TOKEN/);
  });

  it("throws on a non-integer admin id", () => {
    expect(() => loadConfig({ ...base, ADMIN_TELEGRAM_IDS: "111, oops" })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./config`.

- [ ] **Step 3: Write the implementation**

Create `server/src/config.ts`:

```ts
import { z } from "zod";

const intList = z
  .string()
  .transform((s) => s.split(",").map((p) => p.trim()).filter(Boolean))
  .pipe(z.array(z.coerce.number().int()));

const schema = z.object({
  BOT_TOKEN: z.string().min(1),
  ADMIN_TELEGRAM_IDS: intList,
  TEAM_TZ: z.string().min(1).default("Europe/Moscow"),
  DATABASE_URL: z.string().min(1).default("./data/planer.db"),
  JWT_SECRET: z.string().min(16),
  PUBLIC_URL: z.string().url(),
});

export interface Config {
  botToken: string;
  adminTelegramIds: number[];
  teamTz: string;
  databaseUrl: string;
  jwtSecret: string;
  publicUrl: string;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const e = parsed.data;
  return {
    botToken: e.BOT_TOKEN,
    adminTelegramIds: e.ADMIN_TELEGRAM_IDS,
    teamTz: e.TEAM_TZ,
    databaseUrl: e.DATABASE_URL,
    jwtSecret: e.JWT_SECRET,
    publicUrl: e.PUBLIC_URL,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `loadConfig` tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/config.ts server/src/config.test.ts
git commit -m "feat(server): typed env config loader"
```

---

### Task 6: Seed default shift presets

**Files:**
- Create: `server/src/db/seed.ts`
- Test: `server/src/db/seed.test.ts`

**Interfaces:**
- Consumes: `Db` from `./client`, `shiftTemplates` from `./schema`.
- Produces: `seedDefaultTemplates(db: Db): void` — inserts the four presets (Утро/День/Вечер/Ночь with Friday overrides) only if the table is empty (idempotent). Presets: Утро 08:00–17:00 (пт 08:00–15:45); День 09:00–18:00 (пт 09:00–16:45); Вечер 11:00–20:00 (пт 12:00–20:00, `isLate`, `sendReminder:false`); Ночь 15:00–23:00 (пт 16:00–23:00, `isLate`, `sendReminder:true`). Утро has `sendReminder:true`.

- [ ] **Step 1: Write the failing test**

Create `server/src/db/seed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "./testdb";
import { seedDefaultTemplates } from "./seed";
import { shiftTemplates } from "./schema";

describe("seedDefaultTemplates", () => {
  it("inserts the four presets with Friday overrides and late flags", () => {
    const db = makeTestDb();
    seedDefaultTemplates(db);
    const rows = db.select().from(shiftTemplates).orderBy(shiftTemplates.sortOrder).all();
    expect(rows.map((r) => r.name)).toEqual(["Утро", "День", "Вечер", "Ночь"]);

    const evening = rows.find((r) => r.name === "Вечер")!;
    expect(evening.fridayStart).toBe("12:00");
    expect(evening.isLate).toBe(true);

    const night = rows.find((r) => r.name === "Ночь")!;
    expect(night.isLate).toBe(true);
    expect(night.sendReminder).toBe(true);

    const morning = rows.find((r) => r.name === "Утро")!;
    expect(morning.fridayEnd).toBe("15:45");
    expect(morning.sendReminder).toBe(true);
  });

  it("is idempotent (running twice keeps four rows)", () => {
    const db = makeTestDb();
    seedDefaultTemplates(db);
    seedDefaultTemplates(db);
    expect(db.select().from(shiftTemplates).all().length).toBe(4);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./seed`.

- [ ] **Step 3: Write the implementation**

Create `server/src/db/seed.ts`:

```ts
import type { Db } from "./client";
import { shiftTemplates, type NewShiftTemplate } from "./schema";

const DEFAULT_TEMPLATES: NewShiftTemplate[] = [
  { name: "Утро", start: "08:00", end: "17:00", fridayStart: "08:00", fridayEnd: "15:45", isLate: false, sendReminder: true, sortOrder: 0 },
  { name: "День", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: false, sortOrder: 1 },
  { name: "Вечер", start: "11:00", end: "20:00", fridayStart: "12:00", fridayEnd: "20:00", isLate: true, sendReminder: false, sortOrder: 2 },
  { name: "Ночь", start: "15:00", end: "23:00", fridayStart: "16:00", fridayEnd: "23:00", isLate: true, sendReminder: true, sortOrder: 3 },
];

/** Insert the default presets once. No-op if any template already exists. */
export function seedDefaultTemplates(db: Db): void {
  const existing = db.select({ id: shiftTemplates.id }).from(shiftTemplates).limit(1).all();
  if (existing.length > 0) return;
  db.insert(shiftTemplates).values(DEFAULT_TEMPLATES).run();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — presets seeded correctly and idempotently.

- [ ] **Step 5: Commit**

```bash
git add server/src/db/seed.ts server/src/db/seed.test.ts
git commit -m "feat(server): idempotent seed of default shift presets"
```

---

### Task 7: Repository layer (employees, templates, shifts) + integration test

**Files:**
- Create: `server/src/repo/employees.ts`
- Create: `server/src/repo/templates.ts`
- Create: `server/src/repo/shifts.ts`
- Test: `server/src/repo/repo.test.ts`

**Interfaces:**
- Consumes: `Db`, schema tables, `eq`/`and`/`gte`/`isNull` from `drizzle-orm`.
- Produces:
  - employees.ts: `createEmployee(db, data: { displayName: string; inviteToken?: string; isAdmin?: boolean }): Employee`; `linkTelegramAccount(db, inviteToken: string, telegramUserId: number, tgUsername?: string): Employee | null` (sets `telegramUserId`, clears `inviteToken`, returns the employee or `null` if no match); `getByTelegramId(db, telegramUserId: number): Employee | undefined`; `listActive(db): Employee[]`.
  - templates.ts: `listActiveTemplates(db): ShiftTemplate[]` (ordered by `sortOrder`).
  - shifts.ts: `createShift(db, data: NewShift): Shift`; `getShift(db, id: number): Shift | undefined`; `listShiftsInRange(db, startDate: string, endDate: string): Shift[]` (inclusive, ordered by date then start); `listUpcomingForEmployee(db, employeeId: number, fromDate: string): Shift[]`.

- [ ] **Step 1: Write the failing test**

Create `server/src/repo/repo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { seedDefaultTemplates } from "../db/seed";
import { createEmployee, linkTelegramAccount, getByTelegramId, listActive } from "./employees";
import { listActiveTemplates } from "./templates";
import { createShift, getShift, listShiftsInRange, listUpcomingForEmployee } from "./shifts";

describe("repository", () => {
  it("creates and links an employee by invite token", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "tok-123" });
    expect(getByTelegramId(db, 555)).toBeUndefined();

    const linked = linkTelegramAccount(db, "tok-123", 555, "anya");
    expect(linked?.id).toBe(anya.id);
    expect(linked?.telegramUserId).toBe(555);
    expect(linked?.inviteToken).toBeNull();
    expect(getByTelegramId(db, 555)?.displayName).toBe("Аня");

    // token is single-use
    expect(linkTelegramAccount(db, "tok-123", 999)).toBeNull();
  });

  it("lists active employees only", () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });
    expect(listActive(db).map((e) => e.displayName).sort()).toEqual(["Аня", "Игорь"]);
    expect(igor.isActive).toBe(true);
  });

  it("reads seeded templates in order", () => {
    const db = makeTestDb();
    seedDefaultTemplates(db);
    expect(listActiveTemplates(db).map((t) => t.name)).toEqual(["Утро", "День", "Вечер", "Ночь"]);
  });

  it("creates shifts and queries by range and by employee", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const s1 = createShift(db, { date: "2026-07-01", start: "08:00", end: "17:00", employeeId: anya.id });
    createShift(db, { date: "2026-07-06", start: "11:00", end: "20:00", employeeId: anya.id });
    createShift(db, { date: "2026-07-20", start: "09:00", end: "18:00", employeeId: anya.id });

    expect(getShift(db, s1.id)?.date).toBe("2026-07-01");
    expect(listShiftsInRange(db, "2026-07-01", "2026-07-07").map((s) => s.date)).toEqual(["2026-07-01", "2026-07-06"]);
    expect(listUpcomingForEmployee(db, anya.id, "2026-07-05").map((s) => s.date)).toEqual(["2026-07-06", "2026-07-20"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./employees`.

- [ ] **Step 3: Write the implementations**

Create `server/src/repo/employees.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { employees, type Employee } from "../db/schema";

export function createEmployee(
  db: Db,
  data: { displayName: string; inviteToken?: string; isAdmin?: boolean },
): Employee {
  return db.insert(employees).values(data).returning().all()[0]!;
}

export function linkTelegramAccount(
  db: Db,
  inviteToken: string,
  telegramUserId: number,
  tgUsername?: string,
): Employee | null {
  const rows = db
    .update(employees)
    .set({ telegramUserId, tgUsername: tgUsername ?? null, inviteToken: null })
    .where(eq(employees.inviteToken, inviteToken))
    .returning()
    .all();
  return rows[0] ?? null;
}

export function getByTelegramId(db: Db, telegramUserId: number): Employee | undefined {
  return db.select().from(employees).where(eq(employees.telegramUserId, telegramUserId)).get();
}

export function listActive(db: Db): Employee[] {
  return db.select().from(employees).where(eq(employees.isActive, true)).all();
}
```

Create `server/src/repo/templates.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { shiftTemplates, type ShiftTemplate } from "../db/schema";

export function listActiveTemplates(db: Db): ShiftTemplate[] {
  return db
    .select()
    .from(shiftTemplates)
    .where(eq(shiftTemplates.isActive, true))
    .orderBy(shiftTemplates.sortOrder)
    .all();
}
```

Create `server/src/repo/shifts.ts`:

```ts
import { and, eq, gte, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import { shifts, type Shift, type NewShift } from "../db/schema";

export function createShift(db: Db, data: NewShift): Shift {
  return db.insert(shifts).values(data).returning().all()[0]!;
}

export function getShift(db: Db, id: number): Shift | undefined {
  return db.select().from(shifts).where(eq(shifts.id, id)).get();
}

export function listShiftsInRange(db: Db, startDate: string, endDate: string): Shift[] {
  return db
    .select()
    .from(shifts)
    .where(and(gte(shifts.date, startDate), lte(shifts.date, endDate)))
    .orderBy(shifts.date, shifts.start)
    .all();
}

export function listUpcomingForEmployee(db: Db, employeeId: number, fromDate: string): Shift[] {
  return db
    .select()
    .from(shifts)
    .where(and(eq(shifts.employeeId, employeeId), gte(shifts.date, fromDate)))
    .orderBy(shifts.date, shifts.start)
    .all();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `repository` cases green.

- [ ] **Step 5: Typecheck the whole repo**

Run: `npm run typecheck` (add a `server` project reference or run `tsc -p server/tsconfig.json` — see note)
Expected: no type errors.

Note: the root `typecheck` script currently targets `shared` only. Update root `package.json` `typecheck` to `tsc -p shared/tsconfig.json && tsc -p server/tsconfig.json` as part of this task, and verify both pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/repo package.json
git commit -m "feat(server): employee/template/shift repositories with integration test"
```

---

## Done criteria

- `npm test` → all suites pass (shared + server).
- `npm run typecheck` → clean for both workspaces.
- An in-memory SQLite db migrates from committed SQL; presets seed idempotently; repositories create/link/query correctly.

## Notes for later plans

- `nextSwapStatus` (Plan 1) currently throws on invalid transitions; the swap endpoint (Plan 5) should guard on `status === "pending"` before calling it so the throw stays a safety net, not control flow. Revisit throw-vs-Result then.
- Run/build story: dev runs via `tsx`; production build (esbuild/tsup bundling `@planer/shared` in) is decided at the HTTP-server plan.
- `swapRequests`/`reminderLog`/`auditLog` tables exist now; their repositories arrive with the swap (Plan 5) and reminder (later) features.

## Next plan

Plan 3 — **HTTP + auth**: Hono server, Telegram `initData` HMAC validation → JWT issue/verify, admin gating middleware, and the first read endpoints (my shifts, templates) wired to these repositories.
