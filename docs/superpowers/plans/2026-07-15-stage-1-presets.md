# Этап 1: пресеты — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrations become the single owner of shift presets: `seedDefaultTemplates` is deleted, the «Дежурство · Поклонка» hours bug is fixed on both the live and fresh-database paths, three new presets are created, and the inert configuration columns + tables that Stages 2–4 need are added.

**Architecture:** Today `runMigrations` runs first and `seedDefaultTemplates` creates the 5 presets *after* it (`server/src/index.ts:18-19`). Any `UPDATE ... WHERE name=` inside a migration therefore matches zero rows on a fresh database — the presets do not exist yet. We invert the authority: migration 0006 creates all 8 presets with a guarded insert and then applies the authoritative values by name, and the seed is deleted outright. Config columns default to values that mean "not a role", so this migration changes no scheduling behaviour.

**Tech Stack:** TypeScript, Drizzle ORM + drizzle-kit, better-sqlite3, Vitest.

**Spec:** [2026-07-15-duty-roles-coverage-import-design.md](../specs/2026-07-15-duty-roles-coverage-import-design.md) — Stage 1 is §6 «Этап 1»; the technical detail is §8.2, §8.3, §8.4.

## Global Constraints

- **Generate migrations from the repo ROOT:** `npx drizzle-kit generate` — the config lives at `/Users/user/planer-bot/drizzle.config.ts`, not in `server/`. `npm run db:generate -w @planer/server` FAILS (npm sets cwd to `server/`, drizzle-kit reports "drizzle.config.json file does not exist").
- **Commit the `.sql`, the `meta/NNNN_snapshot.json` and `meta/_journal.json` together.** Staging only the journal ships a migration that never runs.
- **Never `cp` the live database.** `data/planer.db` is 4096 bytes with a ~750KB WAL held open by the running server; a copied file opens with zero tables. Use `sqlite3 data/planer.db ".backup <path>"`.
- **The mini app must not import `@planer/shared`.** `miniapp/package.json` has no such dependency; it hand-mirrors every type (`miniapp/src/categories.tsx:6`). Mirror, don't import.
- **Category and accent tables are duplicated** in `admin/src/categories.tsx` and `miniapp/src/categories.tsx` and have silently drifted apart before. Change both, always.
- **Neither frontend is typechecked** (`npm run typecheck` covers only `shared/` and `server/`) and there are zero frontend tests. Frontend edits land unverified — read them twice.
- **Existing preset ids 1–5 are load-bearing.** `shifts.templateId` already references them in production (`1=Утро, 2=День, 3=Вечер, 4=Ночь, 5=Дежурство · Поклонка`). Never delete/recreate them.
- **Baseline:** `npx vitest run` is green at 40 files / 218 tests before this plan starts. It must be green after every task.

---

### Task 1: The «amber» accent

Eight presets need eight distinguishable colours; only seven accents exist (`gold, blue, violet, indigo, teal, green, rose`) and all seven are about to be used (`gold=Утро, blue=День, violet=Вечер, indigo=Ночь, teal=Поклонка, green=Вавилова, rose=Телефон`). «Открытие» needs an eighth.

This task must land **before** Task 3, which writes `accent='amber'` into the database. `admin/src/categories.tsx:101` resolves the palette with `(isDark ? DARK_ACCENTS : LIGHT_ACCENTS)[accent]` — an unknown accent returns `undefined` and the caller then reads `.bg` off it and throws.

Colour values are calibrated against the existing family rather than picked by eye: the current accents sit at ~7.0–7.1:1 contrast in light and ~6.4–6.7:1 in dark. The values below measure **7.18:1** light and **6.70:1** dark. (A previous preset shipped at 4.32:1 and had to be fixed — don't repeat it.)

**Files:**
- Modify: `shared/src/category.ts:28`
- Modify: `admin/src/categories.tsx:64-82`
- Modify: `miniapp/src/categories.tsx:6`, and its two accent maps
- Test: `shared/src/category.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TemplateAccent` gains the literal `"amber"`. Task 3 uses it as the accent of the «Открытие» preset.

- [ ] **Step 1: Write the failing test**

Append to `shared/src/category.test.ts`:

```ts
describe("templateAccents", () => {
  it("has a distinct colour slot for each of the eight presets", () => {
    expect(templateAccents).toEqual(["gold", "blue", "violet", "indigo", "teal", "green", "rose", "amber"]);
    expect(new Set(templateAccents).size).toBe(templateAccents.length);
  });
});
```

Make sure `templateAccents` is in the file's import from `./category` — check the existing import line and add it if missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/src/category.test.ts`
Expected: FAIL — received array ends at `"rose"`, expected `"amber"` as the 8th element.

- [ ] **Step 3: Add the accent to the shared list**

`shared/src/category.ts:28` — replace the line with:

```ts
export const templateAccents = ["gold", "blue", "violet", "indigo", "teal", "green", "rose", "amber"] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/src/category.test.ts`
Expected: PASS

- [ ] **Step 5: Add amber to the desktop console's two palettes**

`admin/src/categories.tsx` — add one line to the end of each map (after `rose`, keeping the object's existing order):

In `LIGHT_ACCENTS` (line 64-72):
```ts
  amber: { bg: "#FBE8D6", fg: "#7E3803" },
```

In `DARK_ACCENTS` (line 74-82):
```ts
  amber: { bg: "rgba(224,128,64,0.24)", fg: "#F5B98A" },
```

`Record<TemplateAccent, CategoryPalette>` makes both maps exhaustive — omitting one is a type error in `admin/`, but note `admin/` is NOT in `npm run typecheck`, so nothing will tell you. Add both.

- [ ] **Step 6: Add amber to the mini app's mirrored type and two palettes**

`miniapp/src/categories.tsx:6` — replace the union with:

```ts
export type TemplateAccent = "gold" | "blue" | "violet" | "indigo" | "teal" | "green" | "rose" | "amber";
```

Then add the identical two lines to the mini app's own `LIGHT_ACCENTS` and `DARK_ACCENTS` maps (same values as Step 5 — the palettes are deliberately identical copies; only the type declaration differs because the mini app can't import from `@planer/shared`).

- [ ] **Step 7: Verify both frontends still build**

Run: `npm run build --workspace @planer/admin && npm run build --workspace @planer/miniapp`
Expected: both succeed. (This is the only automated check the frontends have — there are no frontend tests.)

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: 40 files, 219 tests, all pass.

- [ ] **Step 9: Commit**

```bash
git add shared/src/category.ts shared/src/category.test.ts admin/src/categories.tsx miniapp/src/categories.tsx
git commit -m "feat: add the amber accent so all eight presets read apart

Calibrated to the existing family: 7.18:1 light, 6.70:1 dark."
```

---

### Task 2: Config columns and the three new tables

Adds everything Stages 2–4 need, all inert. `coverage` defaults to `'0,0,0,0,0,0,0'` — "this preset is not a role, never materialise it" — so no scheduling behaviour changes.

**Files:**
- Modify: `server/src/db/schema.ts:23-41` (shiftTemplates) and the type exports at `:130-147`
- Create: `server/drizzle/0006_*.sql` + `server/drizzle/meta/0006_snapshot.json` (generated)
- Modify: `server/drizzle/meta/_journal.json` (generated)
- Test: `server/src/db/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `shiftTemplates.coverage: string` (7 comma-separated ints, Mon..Sun), `.fillMode: "count" | "remainder"`, `.rotationUnit: "day" | "week"`, `.primaryEmployeeId: number | null`.
  - `templatePool` table → `TemplatePool` / `NewTemplatePool` types.
  - `templatePreference` table → `TemplatePreference` / `NewTemplatePreference` types.
  - `calendarDays` table → `CalendarDay` / `NewCalendarDay` types.
  - Task 3 sets `coverage`/`fillMode`/`rotationUnit` values; Stage 3 populates the tables.

- [ ] **Step 1: Write the failing test**

Append to `server/src/db/schema.test.ts`:

```ts
describe("role configuration columns", () => {
  it("defaults every preset to 'not a role' so the migration is inert", () => {
    const db = makeTestDb();
    db.insert(shiftTemplates).values({ name: "X", start: "09:00", end: "18:00" }).run();
    const row = db.select().from(shiftTemplates).all()[0]!;
    expect(row.coverage).toBe("0,0,0,0,0,0,0");
    expect(row.fillMode).toBe("count");
    expect(row.rotationUnit).toBe("day");
    expect(row.primaryEmployeeId).toBeNull();
  });

  it("stores a pool membership, a preference and a calendar day", () => {
    const db = makeTestDb();
    const tpl = db.insert(shiftTemplates).values({ name: "X", start: "09:00", end: "18:00" }).returning().all()[0]!;
    const emp = db.insert(employees).values({ displayName: "Аня" }).returning().all()[0]!;

    db.insert(templatePool).values({ templateId: tpl.id, employeeId: emp.id }).run();
    expect(db.select().from(templatePool).all()).toHaveLength(1);

    db.insert(templatePreference).values({ templateId: tpl.id, employeeId: emp.id }).run();
    expect(db.select().from(templatePreference).all()[0]!.weight).toBe(1);

    db.insert(calendarDays).values({ date: "2026-06-12", kind: "holiday", note: "День России" }).run();
    expect(db.select().from(calendarDays).all()[0]!.kind).toBe("holiday");
  });

  it("refuses a second pool row for the same person on the same preset", () => {
    const db = makeTestDb();
    const tpl = db.insert(shiftTemplates).values({ name: "X", start: "09:00", end: "18:00" }).returning().all()[0]!;
    const emp = db.insert(employees).values({ displayName: "Аня" }).returning().all()[0]!;
    db.insert(templatePool).values({ templateId: tpl.id, employeeId: emp.id }).run();
    expect(() => db.insert(templatePool).values({ templateId: tpl.id, employeeId: emp.id }).run()).toThrow(/UNIQUE/i);
  });
});
```

Add `templatePool`, `templatePreference`, `calendarDays`, `employees` to the file's existing import from `./schema`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/db/schema.test.ts`
Expected: FAIL — `templatePool` is not exported / `row.coverage` is undefined.

- [ ] **Step 3: Add the columns to `shiftTemplates`**

`server/src/db/schema.ts` — add these fields inside `shiftTemplates`, after `isActive` (line 40):

```ts
  /** How many people this preset needs per weekday, Mon..Sun — 7 comma-separated ints.
   *  '0,0,0,0,0,0,0' (the default) means "not a role": never materialised, today's behaviour.
   *  '1,1,1,1,1,0,0' — the five roles that need exactly one person every working day.
   *  '3,2,2,2,2,0,0' — «Утро»: three people on Mondays, two otherwise (measured, exact). */
  coverage: text().notNull().default("0,0,0,0,0,0,0"),
  /** 'count' — materialise coverage[weekday] rows. 'remainder' — take everyone left
   *  unscheduled that day. At most one active preset may be the remainder. */
  fillMode: text().$type<"count" | "remainder">().notNull().default("count"),
  /** 'day' — decided per day. 'week' — one holder claims the whole ISO week. */
  rotationUnit: text().$type<"day" | "week">().notNull().default("day"),
  /** Whose job this is by default. A hard pre-claim with pool fallback, not a tiebreak. */
  primaryEmployeeId: integer().references(() => employees.id),
```

`employees` is already imported into this file's scope — it is declared above `shiftTemplates` in the same module, so the `references()` callback resolves without a new import.

- [ ] **Step 4: Add the three tables**

`server/src/db/schema.ts` — append after `weekendAssignments` (line 128), before the type exports:

```ts
/** Who is allowed on a preset. ZERO rows for a preset means everyone is allowed. */
export const templatePool = sqliteTable(
  "template_pool",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    templateId: integer().notNull().references(() => shiftTemplates.id),
    employeeId: integer().notNull().references(() => employees.id),
  },
  (t) => [uniqueIndex("template_pool_unique").on(t.templateId, t.employeeId)],
);

/** What a worker would rather have. Only ever breaks an exact tie. */
export const templatePreference = sqliteTable(
  "template_preference",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    templateId: integer().notNull().references(() => shiftTemplates.id),
    employeeId: integer().notNull().references(() => employees.id),
    weight: integer().notNull().default(1),
  },
  (t) => [uniqueIndex("template_preference_unique").on(t.templateId, t.employeeId)],
);

/** Public holidays and Russia's transferred working Saturdays. */
export const calendarDays = sqliteTable("calendar_days", {
  date: text().primaryKey(),
  kind: text().$type<"holiday" | "workday">().notNull(),
  note: text(),
});
```

Then append to the type exports at the bottom:

```ts
export type TemplatePool = typeof templatePool.$inferSelect;
export type NewTemplatePool = typeof templatePool.$inferInsert;
export type TemplatePreference = typeof templatePreference.$inferSelect;
export type NewTemplatePreference = typeof templatePreference.$inferInsert;
export type CalendarDay = typeof calendarDays.$inferSelect;
export type NewCalendarDay = typeof calendarDays.$inferInsert;
```

- [ ] **Step 5: Generate migration 0006**

Run from the repo root — not from `server/`:

```bash
cd /Users/user/planer-bot && npx drizzle-kit generate
```

Expected: creates `server/drizzle/0006_<random_name>.sql`, `server/drizzle/meta/0006_snapshot.json`, and appends an entry to `server/drizzle/meta/_journal.json`.

- [ ] **Step 6: Read the generated SQL and confirm it is additive only**

Run: `cat server/drizzle/0006_*.sql`

Expected: four `ALTER TABLE shift_templates ADD ...` statements and three `CREATE TABLE` + two `CREATE UNIQUE INDEX` statements. **There must be no `DROP` and no table rebuild.** A plain `ADD COLUMN` will not trip the FK-rebuild guard in `db/client.ts:19-35`. If drizzle-kit proposes to recreate `shift_templates`, stop and investigate rather than accepting it.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run server/src/db/schema.test.ts`
Expected: PASS — all three new tests.

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: 40 files, 222 tests, all pass; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add server/src/db/schema.ts server/src/db/schema.test.ts server/drizzle/
git commit -m "feat(db): add inert role-config columns, pools, preferences and a day calendar

coverage defaults to '0,0,0,0,0,0,0' — not a role — so nothing materialises
and no scheduling behaviour changes."
```

---

### Task 3: Migrations take ownership of the presets; the seed is deleted

The heart of the stage. Verified empirically: on a fresh database, boot runs `runMigrations` then `seedDefaultTemplates`, so the presets are created **by the seed, after the migration** — and a migration's `UPDATE ... WHERE name='Дежурство · Поклонка'` matches zero rows. Fixing the hours in a migration alone would work on exactly one machine (the live one) and silently not work anywhere else.

The fix is to delete the seed and let migration 0006 both create and configure the presets.

**Files:**
- Modify: `server/drizzle/0006_*.sql` (append data statements by hand — drizzle-kit only generates DDL)
- Delete: `server/src/db/seed.ts`, `server/src/db/seed.test.ts`
- Create: `server/src/db/presets.test.ts`
- Modify: `server/src/index.ts:9,19`
- Modify: `server/src/http/read.test.ts:4,32,37`
- Modify: `server/src/repo/repo.test.ts:4,44,45`

**Interfaces:**
- Consumes: `"amber"` from Task 1; the `coverage`/`fillMode`/`rotationUnit` columns from Task 2.
- Produces: eight presets present on every database, with ids `1=Утро, 2=День, 3=Вечер, 4=Ночь, 5=Дежурство · Поклонка, 6=Открытие, 7=Дежурство · Телефон, 8=Дежурство · Вавилова 19`. `seedDefaultTemplates` no longer exists — Stage 2's import resolves preset names against these rows.

- [ ] **Step 1: Write the failing test**

Create `server/src/db/presets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "./testdb";
import { shiftTemplates } from "./schema";

/** The authoritative preset table — mirrors the spec's §8.3. Migration 0006 must produce exactly this. */
const EXPECTED = [
  { id: 1, name: "Утро",                    category: "shift", accent: "gold",   location: null,        start: "08:00", end: "17:00", fridayStart: "08:00", fridayEnd: "15:45" },
  { id: 2, name: "День",                    category: "shift", accent: "blue",   location: null,        start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45" },
  { id: 3, name: "Вечер",                   category: "shift", accent: "violet", location: null,        start: "11:00", end: "20:00", fridayStart: "12:00", fridayEnd: "20:00" },
  { id: 4, name: "Ночь",                    category: "shift", accent: "indigo", location: null,        start: "15:00", end: "23:00", fridayStart: "16:00", fridayEnd: "23:00" },
  { id: 5, name: "Дежурство · Поклонка",    category: "duty",  accent: "teal",   location: "Поклонка",  start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45" },
  { id: 6, name: "Открытие",                category: "shift", accent: "amber",  location: null,        start: "07:00", end: "16:00", fridayStart: "07:00", fridayEnd: "14:45" },
  { id: 7, name: "Дежурство · Телефон",     category: "duty",  accent: "rose",   location: null,        start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45" },
  { id: 8, name: "Дежурство · Вавилова 19", category: "duty",  accent: "green",  location: "Вавилова 19", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45" },
];

describe("presets created by migration 0006", () => {
  it("creates all eight with the confirmed decode values", () => {
    const rows = makeTestDb().select().from(shiftTemplates).orderBy(shiftTemplates.id).all();
    expect(rows).toHaveLength(8);
    for (const want of EXPECTED) {
      const row = rows.find((r) => r.id === want.id)!;
      expect({
        id: row.id, name: row.name, category: row.category, accent: row.accent,
        location: row.location, start: row.start, end: row.end,
        fridayStart: row.fridayStart, fridayEnd: row.fridayEnd,
      }).toEqual(want);
    }
  });

  it("fixes the Поклонка hours — the bug was 09:00-21:00", () => {
    const rows = makeTestDb().select().from(shiftTemplates).all();
    const poklonka = rows.find((r) => r.name === "Дежурство · Поклонка")!;
    expect(poklonka.end).toBe("18:00");
    expect(poklonka.fridayEnd).toBe("16:45");
  });

  it("leaves every preset inert — Stage 3 turns roles on, not this one", () => {
    const rows = makeTestDb().select().from(shiftTemplates).all();
    expect(rows.every((r) => r.coverage === "0,0,0,0,0,0,0")).toBe(true);
    expect(rows.every((r) => r.fillMode === "count")).toBe(true);
    expect(rows.every((r) => r.primaryEmployeeId === null)).toBe(true);
  });

  it("gives every preset its own accent so they read apart", () => {
    const accents = makeTestDb().select().from(shiftTemplates).all().map((r) => r.accent);
    expect(new Set(accents).size).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/db/presets.test.ts`
Expected: FAIL — `expect(rows).toHaveLength(8)` receives 0. A migrated database has no presets today; the seed makes them.

- [ ] **Step 3: Append the preset statements to migration 0006**

Open the generated `server/drizzle/0006_*.sql` and append the block below **after** the DDL that drizzle-kit produced.

Two mechanisms, both needed:
- The guarded `INSERT` creates a preset only when its name is absent. On the live database ids 1–5 already exist, so only 6, 7, 8 are inserted; on a fresh database all eight are inserted **in id order**, so both paths converge on identical ids.
- The `UPDATE` then applies the authoritative values by name, which is what actually fixes Поклонка's hours on the live database and makes re-running harmless.

`start` and `end` are SQL keywords — the backticks are required, not decoration.

```sql
--> statement-breakpoint
-- Presets are owned by migrations from here on; seedDefaultTemplates is deleted.
-- Inserted in the order of the ids that already exist in production (1..5) so that
-- a fresh database and the live one converge on identical ids.
INSERT INTO `shift_templates` (`name`, `category`, `accent`, `location`, `start`, `end`, `friday_start`, `friday_end`, `is_late`, `send_reminder`, `sort_order`, `is_active`)
SELECT 'Утро', 'shift', 'gold', NULL, '08:00', '17:00', '08:00', '15:45', 0, 1, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM `shift_templates` WHERE `name` = 'Утро');--> statement-breakpoint
INSERT INTO `shift_templates` (`name`, `category`, `accent`, `location`, `start`, `end`, `friday_start`, `friday_end`, `is_late`, `send_reminder`, `sort_order`, `is_active`)
SELECT 'День', 'shift', 'blue', NULL, '09:00', '18:00', '09:00', '16:45', 0, 0, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM `shift_templates` WHERE `name` = 'День');--> statement-breakpoint
INSERT INTO `shift_templates` (`name`, `category`, `accent`, `location`, `start`, `end`, `friday_start`, `friday_end`, `is_late`, `send_reminder`, `sort_order`, `is_active`)
SELECT 'Вечер', 'shift', 'violet', NULL, '11:00', '20:00', '12:00', '20:00', 1, 0, 2, 1
WHERE NOT EXISTS (SELECT 1 FROM `shift_templates` WHERE `name` = 'Вечер');--> statement-breakpoint
INSERT INTO `shift_templates` (`name`, `category`, `accent`, `location`, `start`, `end`, `friday_start`, `friday_end`, `is_late`, `send_reminder`, `sort_order`, `is_active`)
SELECT 'Ночь', 'shift', 'indigo', NULL, '15:00', '23:00', '16:00', '23:00', 1, 1, 3, 1
WHERE NOT EXISTS (SELECT 1 FROM `shift_templates` WHERE `name` = 'Ночь');--> statement-breakpoint
INSERT INTO `shift_templates` (`name`, `category`, `accent`, `location`, `start`, `end`, `friday_start`, `friday_end`, `is_late`, `send_reminder`, `sort_order`, `is_active`)
SELECT 'Дежурство · Поклонка', 'duty', 'teal', 'Поклонка', '09:00', '18:00', '09:00', '16:45', 0, 1, 4, 1
WHERE NOT EXISTS (SELECT 1 FROM `shift_templates` WHERE `name` = 'Дежурство · Поклонка');--> statement-breakpoint
INSERT INTO `shift_templates` (`name`, `category`, `accent`, `location`, `start`, `end`, `friday_start`, `friday_end`, `is_late`, `send_reminder`, `sort_order`, `is_active`)
SELECT 'Открытие', 'shift', 'amber', NULL, '07:00', '16:00', '07:00', '14:45', 0, 1, 5, 1
WHERE NOT EXISTS (SELECT 1 FROM `shift_templates` WHERE `name` = 'Открытие');--> statement-breakpoint
INSERT INTO `shift_templates` (`name`, `category`, `accent`, `location`, `start`, `end`, `friday_start`, `friday_end`, `is_late`, `send_reminder`, `sort_order`, `is_active`)
SELECT 'Дежурство · Телефон', 'duty', 'rose', NULL, '09:00', '18:00', '09:00', '16:45', 0, 1, 6, 1
WHERE NOT EXISTS (SELECT 1 FROM `shift_templates` WHERE `name` = 'Дежурство · Телефон');--> statement-breakpoint
INSERT INTO `shift_templates` (`name`, `category`, `accent`, `location`, `start`, `end`, `friday_start`, `friday_end`, `is_late`, `send_reminder`, `sort_order`, `is_active`)
SELECT 'Дежурство · Вавилова 19', 'duty', 'green', 'Вавилова 19', '09:00', '18:00', '09:00', '16:45', 0, 1, 7, 1
WHERE NOT EXISTS (SELECT 1 FROM `shift_templates` WHERE `name` = 'Дежурство · Вавилова 19');--> statement-breakpoint
-- Authoritative values, applied by name. This is what fixes the live «Дежурство · Поклонка»,
-- whose hours were seeded as 09:00-21:00, and what makes re-running this block a no-op.
UPDATE `shift_templates` SET `category`='shift', `accent`='gold',   `location`=NULL,          `start`='08:00', `end`='17:00', `friday_start`='08:00', `friday_end`='15:45', `is_late`=0, `send_reminder`=1, `sort_order`=0 WHERE `name`='Утро';--> statement-breakpoint
UPDATE `shift_templates` SET `category`='shift', `accent`='blue',   `location`=NULL,          `start`='09:00', `end`='18:00', `friday_start`='09:00', `friday_end`='16:45', `is_late`=0, `send_reminder`=0, `sort_order`=1 WHERE `name`='День';--> statement-breakpoint
UPDATE `shift_templates` SET `category`='shift', `accent`='violet', `location`=NULL,          `start`='11:00', `end`='20:00', `friday_start`='12:00', `friday_end`='20:00', `is_late`=1, `send_reminder`=0, `sort_order`=2 WHERE `name`='Вечер';--> statement-breakpoint
UPDATE `shift_templates` SET `category`='shift', `accent`='indigo', `location`=NULL,          `start`='15:00', `end`='23:00', `friday_start`='16:00', `friday_end`='23:00', `is_late`=1, `send_reminder`=1, `sort_order`=3 WHERE `name`='Ночь';--> statement-breakpoint
UPDATE `shift_templates` SET `category`='duty',  `accent`='teal',   `location`='Поклонка',    `start`='09:00', `end`='18:00', `friday_start`='09:00', `friday_end`='16:45', `is_late`=0, `send_reminder`=1, `sort_order`=4 WHERE `name`='Дежурство · Поклонка';--> statement-breakpoint
UPDATE `shift_templates` SET `category`='shift', `accent`='amber',  `location`=NULL,          `start`='07:00', `end`='16:00', `friday_start`='07:00', `friday_end`='14:45', `is_late`=0, `send_reminder`=1, `sort_order`=5 WHERE `name`='Открытие';--> statement-breakpoint
UPDATE `shift_templates` SET `category`='duty',  `accent`='rose',   `location`=NULL,          `start`='09:00', `end`='18:00', `friday_start`='09:00', `friday_end`='16:45', `is_late`=0, `send_reminder`=1, `sort_order`=6 WHERE `name`='Дежурство · Телефон';--> statement-breakpoint
UPDATE `shift_templates` SET `category`='duty',  `accent`='green',  `location`='Вавилова 19', `start`='09:00', `end`='18:00', `friday_start`='09:00', `friday_end`='16:45', `is_late`=0, `send_reminder`=1, `sort_order`=7 WHERE `name`='Дежурство · Вавилова 19';
```

**Note on `sort_order`:** these are the *existing* orders with the three new presets appended (5, 6, 7). The spec's §8.3 table lists a different `sort_order` — that is the phase order the distributor needs, and Stage 3 rewrites it along with the rest of the role config. Stage 1 must not reorder the preset list a user already knows.

**Before moving on, check the INSERT and the UPDATE agree for every preset.** They carry the same 8 rows twice; a value that differs between them makes the result depend on whether the row already existed — which is exactly the class of bug this task exists to kill. `is_late` is 1 only for «Вечер» and «Ночь».

- [ ] **Step 4: Run the presets test**

Run: `npx vitest run server/src/db/presets.test.ts`
Expected: PASS — all four tests. If ids are off, check that the INSERT order matches 1..8.

- [ ] **Step 5: Delete the seed and its test**

```bash
git rm server/src/db/seed.ts server/src/db/seed.test.ts
```

`seed.test.ts` tested behaviour that no longer exists (insert-if-missing, backfill, idempotency). `presets.test.ts` covers the same ground against the migration, which is now the only writer.

- [ ] **Step 6: Remove the seed call from boot**

`server/src/index.ts` — delete line 9 (`import { seedDefaultTemplates } from "./db/seed";`) and line 19 (`seedDefaultTemplates(db);`). `runMigrations(db, sqlite);` on line 18 now leaves the database fully formed.

- [ ] **Step 7: Update the two tests that called the seed**

`server/src/http/read.test.ts` — delete the import on line 4 and the `seedDefaultTemplates(db);` call on line 32, then update the assertion on line 37 to the eight presets in `sort_order`:

```ts
    expect((await res.json()).templates.map((t: { name: string }) => t.name)).toEqual([
      "Утро", "День", "Вечер", "Ночь", "Дежурство · Поклонка", "Открытие", "Дежурство · Телефон", "Дежурство · Вавилова 19",
    ]);
```

`server/src/repo/repo.test.ts` — delete the import on line 4 and the call on line 44, then update line 45 the same way:

```ts
    expect(listActiveTemplates(db).map((t) => t.name)).toEqual([
      "Утро", "День", "Вечер", "Ночь", "Дежурство · Поклонка", "Открытие", "Дежурство · Телефон", "Дежурство · Вавилова 19",
    ]);
```

Both tests now read what the migration made — `makeTestDb()` runs migrations only, so the presets are simply there.

- [ ] **Step 8: Confirm nothing else references the seed**

Run: `grep -rn "seedDefaultTemplates" server/src shared/src admin/src miniapp/src`
Expected: no matches.

- [ ] **Step 9: Run the full suite and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: 40 files (seed.test.ts gone, presets.test.ts added), all pass; typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add -A server/drizzle server/src/db server/src/index.ts server/src/http/read.test.ts server/src/repo/repo.test.ts
git commit -m "feat(db): migrations own the presets; delete seedDefaultTemplates

The seed ran after runMigrations and created the presets itself, so a
migration could never fix them on a fresh database — the rows did not exist
yet. Migration 0006 now creates all eight and applies authoritative values
by name, which is what finally fixes «Дежурство · Поклонка» (09:00-21:00 ->
09:00-18:00) on every path rather than just the live one."
```

---

### Task 4: Verify on the live database

The stage's whole claim is "the live database and a fresh build converge". That is an empirical claim, so measure it rather than assert it.

**Files:** none — this task only reads, backs up, and runs.

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: a verified live database with 8 presets and Поклонка at 09:00–18:00.

- [ ] **Step 1: Back up the live database — with `.backup`, never `cp`**

```bash
sqlite3 data/planer.db ".backup /tmp/planer-pre-0006.db"
sqlite3 /tmp/planer-pre-0006.db "SELECT COUNT(*) FROM employees; SELECT COUNT(*) FROM shifts;"
```

Expected: `6` and `18`. If you see `0` or "no such table", the backup did not capture the WAL — do not proceed. (`cp data/planer.db` produces exactly that failure: the file is 4KB, the data lives in a ~750KB WAL.)

- [ ] **Step 2: Prove the migration works on a fresh database**

```bash
rm -f /tmp/planer-fresh.db
DATABASE_URL=/tmp/planer-fresh.db npx tsx -e '
  import { openDb, runMigrations } from "./server/src/db/client";
  const { db, sqlite } = openDb("/tmp/planer-fresh.db");
  runMigrations(db, sqlite);
'
sqlite3 /tmp/planer-fresh.db "SELECT id,name,start,end,friday_end,accent,coverage FROM shift_templates ORDER BY id;"
```

Expected: 8 rows, ids 1–8, `Дежурство · Поклонка` showing `09:00|18:00|16:45`, every `coverage` = `0,0,0,0,0,0,0`.

- [ ] **Step 3: Run the migration against a copy of the live database**

```bash
cp /tmp/planer-pre-0006.db /tmp/planer-live-test.db
npx tsx -e '
  import { openDb, runMigrations } from "./server/src/db/client";
  const { db, sqlite } = openDb("/tmp/planer-live-test.db");
  runMigrations(db, sqlite);
'
sqlite3 /tmp/planer-live-test.db "SELECT id,name,start,end,friday_end,accent FROM shift_templates ORDER BY id;"
```

(`cp` is fine here — `/tmp/planer-pre-0006.db` is a `.backup` output with no WAL attached.)

Expected: 8 rows, ids 1–8, matching Step 2 exactly. Поклонка is now `09:00|18:00|16:45` — this is the bug fix landing on real data.

- [ ] **Step 4: Prove no existing data was harmed**

```bash
sqlite3 /tmp/planer-live-test.db "
  SELECT COUNT(*) AS employees FROM employees;
  SELECT COUNT(*) AS shifts FROM shifts;
  SELECT COUNT(*) AS orphaned FROM shifts WHERE template_id IS NOT NULL
    AND template_id NOT IN (SELECT id FROM shift_templates);
  PRAGMA foreign_key_check;
"
```

Expected: `6`, `18`, `0`, and no foreign-key violations. The orphan count proves ids 1–5 survived.

- [ ] **Step 5: Diff the two databases' presets**

```bash
diff <(sqlite3 /tmp/planer-fresh.db "SELECT id,name,category,accent,location,start,end,friday_start,friday_end,is_late,send_reminder,sort_order,is_active,coverage,fill_mode,rotation_unit FROM shift_templates ORDER BY id;") \
     <(sqlite3 /tmp/planer-live-test.db "SELECT id,name,category,accent,location,start,end,friday_start,friday_end,is_late,send_reminder,sort_order,is_active,coverage,fill_mode,rotation_unit FROM shift_templates ORDER BY id;") \
  && echo "IDENTICAL — the fresh and live paths converge"
```

Expected: no output from `diff`, then the success line. **This is the stage's headline claim, proven.**

- [ ] **Step 6: Build both frontends before restarting anything**

```bash
npm run build --workspace @planer/admin && npm run build --workspace @planer/miniapp
```

`mountSpa` (`server/src/index.ts:53-78`) throws at boot when `dist` is missing — and it does so *after* migrations have already run, which is a confusing state to debug. Build first.

- [ ] **Step 7: Hand the deploy back to the user**

Do **not** restart the live server yourself. Report to the user:
- the live `.backup` path (`/tmp/planer-pre-0006.db`),
- that a copy of live migrates cleanly to 8 presets with zero orphans,
- that fresh and live converge byte-for-byte,
- that restarting requires stopping the existing `nohup` process first — two long-polls against one `BOT_TOKEN` get Telegram 409s and double reminder ticks.

---

## Self-Review

**Spec coverage (§6 «Этап 1», §8.2, §8.3, §8.4):**
- Three new presets (Открытие, Телефон, Вавилова) → Task 3, Step 3.
- Поклонка 21:00 → 18:00 → Task 3, Step 3 (`UPDATE`), proven in Task 4, Step 3.
- Inert config columns → Task 2, Steps 3–4; asserted inert in Task 3, Step 1.
- `template_pool`, `template_preference`, `calendar_days` → Task 2, Step 4.
- `seedDefaultTemplates` deleted → Task 3, Steps 5–6.
- Fresh and live converge → Task 4, Step 5.
- `read.test.ts:37` / `repo.test.ts:45` updated from 5 to 8 names → Task 3, Step 7.
- `seed.test.ts` replaced by `presets.test.ts` → Task 3, Steps 1 and 5.

**Deviations from the spec, deliberate:**
- **`sort_order`.** The spec's §8.3 table shows the *phase* order (Телефон=1 … День=8). Applying it in Stage 1 would visibly reshuffle the preset list for no benefit, since nothing consumes phase order until Stage 4. Stage 1 appends the new presets at 5/6/7; Stage 3 rewrites `sort_order` with the rest of the role config. **Flag for the spec:** §6's "ничего не изменится" is not strictly true — three new presets do appear in the preset picker.
- **The single-remainder partial unique index** (spec §8.2) is deferred to Stage 3. Nothing sets `fill_mode='remainder'` until then, so the index would guard an empty condition, and drizzle-kit's partial-index generation needs verifying against a real use.
- **`primary_employee_id`** is added but stays NULL — Панов and Пименов do not exist in the database until Stage 2's import.

**Placeholder scan:** none. Every step names exact files, exact commands and expected output.

**Type consistency:** `templateAccents` (Task 1) → `accent='amber'` (Task 3) ✓. `coverage`/`fillMode`/`rotationUnit`/`primaryEmployeeId` (Task 2) → asserted in Task 3's inertness test ✓. `templatePool`/`templatePreference`/`calendarDays` names match between Task 2's schema and its tests ✓.

**Known risk carried into Stage 2:** the accent maps in `admin/src/categories.tsx` and `miniapp/src/categories.tsx` are hand-duplicated with no typecheck on either. Task 1, Step 7 (both builds) is the only gate.
