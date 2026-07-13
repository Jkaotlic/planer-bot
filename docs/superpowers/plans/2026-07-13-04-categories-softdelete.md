# Schedule Categories + Soft-Delete — Implementation Plan (Plan 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the data + domain model for the schedule-entry categories (отпуск / дежурство / выездное / командировка / выходной) and soft-delete (archive) of employees — an additive Drizzle migration, an `EntryCategory` enum + predicate helpers in `@planer/shared`, and archive/restore repositories.

**Architecture:** Pure additions. `@planer/shared` gains an `EntryCategory` type + `isSwappable`/`countsForBalance`/`isAbsence` predicates (no change to existing domain functions). The `shifts` table gains `category` (default `'shift'`), `endDate`, `location`, and nullable `start`/`end` (absences are all-day). `employees` gains `archivedAt`. Repos add `archiveEmployee`/`restoreEmployee`/`listArchived`. No HTTP/bot in this plan.

**Tech Stack:** Drizzle + drizzle-kit (migration), Zod. Vitest.

Design spec: `docs/superpowers/specs/2026-07-13-shift-planner-telegram-bot-design.md` §14.2–14.3. Builds on Plans 1–3.

## Global Constraints

- **Modules:** ESM; extensionless relative imports; `moduleResolution: "Bundler"`. TS `strict`, no `any`.
- **Categories:** `EntryCategory = 'shift' | 'vacation' | 'duty' | 'offsite' | 'business_trip' | 'weekend_work'`. Only `shift` is swappable. Balance counts `shift` + working special types (`duty`, `offsite`, `weekend_work`); absences (`vacation`, `business_trip`) do not count and are all-day (nullable times).
- **Schema casing:** camelCase keys + `casing:"snake_case"` (unchanged). New shift columns: `category`, `endDate`→`end_date`, `location`; employee: `archivedAt`→`archived_at`.
- **Additive & non-breaking:** existing repos/endpoints/tests keep compiling and passing. `@planer/shared`'s existing `Shift`/`shiftSchema` (the timed domain type) is NOT changed — categories live in a new `category.ts` module and on the DB row type only.
- **Soft-delete:** archive = `isActive=false` + `archivedAt=now` + unassign that employee's shifts from a given date onward (`employeeId=null`); restore = `isActive=true` + `archivedAt=null`. Never hard-delete employees.
- **Commits:** one per task, conventional-commits.

## File Structure

```
shared/src/
├── category.ts        # EntryCategory + entryCategorySchema + isSwappable/countsForBalance/isAbsence
└── index.ts           # + export * from "./category"
server/src/
├── db/schema.ts       # shifts: +category/+endDate/+location, start/end → nullable; employees: +archivedAt
├── drizzle/0001_*.sql # generated migration (committed)
└── repo/employees.ts  # + archiveEmployee / restoreEmployee / listArchived
```

---

### Task 1: `EntryCategory` + predicate helpers (`@planer/shared`)

**Files:**
- Create: `shared/src/category.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/src/category.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces:
  - `entryCategorySchema` (zod enum), `type EntryCategory`.
  - `isSwappable(c: EntryCategory): boolean` (only `'shift'`).
  - `isAbsence(c: EntryCategory): boolean` (`vacation`, `business_trip`).
  - `countsForBalance(c: EntryCategory): boolean` (`shift`, `duty`, `offsite`, `weekend_work`).

- [ ] **Step 1: Write the failing test**

Create `shared/src/category.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { entryCategorySchema, isSwappable, isAbsence, countsForBalance, type EntryCategory } from "./category";

const ALL: EntryCategory[] = ["shift", "vacation", "duty", "offsite", "business_trip", "weekend_work"];

describe("entry category", () => {
  it("validates the enum", () => {
    expect(entryCategorySchema.parse("shift")).toBe("shift");
    expect(entryCategorySchema.safeParse("bogus").success).toBe(false);
  });

  it("only regular shifts are swappable", () => {
    expect(ALL.filter(isSwappable)).toEqual(["shift"]);
  });

  it("absences are vacation and business_trip", () => {
    expect(ALL.filter(isAbsence)).toEqual(["vacation", "business_trip"]);
  });

  it("balance counts work, not absences", () => {
    expect(ALL.filter(countsForBalance)).toEqual(["shift", "duty", "offsite", "weekend_work"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./category`.

- [ ] **Step 3: Write the implementation**

Create `shared/src/category.ts`:

```ts
import { z } from "zod";

export const entryCategorySchema = z.enum([
  "shift",
  "vacation",
  "duty",
  "offsite",
  "business_trip",
  "weekend_work",
]);
export type EntryCategory = z.infer<typeof entryCategorySchema>;

const ABSENCES: ReadonlySet<EntryCategory> = new Set(["vacation", "business_trip"]);
const BALANCE_COUNTED: ReadonlySet<EntryCategory> = new Set([
  "shift",
  "duty",
  "offsite",
  "weekend_work",
]);

/** Only regular shifts can be swapped between workers. */
export function isSwappable(category: EntryCategory): boolean {
  return category === "shift";
}

/** Absences (vacation, business trip) — the worker is away, no times. */
export function isAbsence(category: EntryCategory): boolean {
  return ABSENCES.has(category);
}

/** Categories that count toward the fair-distribution balance (work, not absences). */
export function countsForBalance(category: EntryCategory): boolean {
  return BALANCE_COUNTED.has(category);
}
```

Append to `shared/src/index.ts`:

```ts
export * from "./category";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `entry category` cases green.

- [ ] **Step 5: Commit**

```bash
git add shared/src/category.ts shared/src/category.test.ts shared/src/index.ts
git commit -m "feat(shared): EntryCategory + swap/balance/absence predicates"
```

---

### Task 2: Schema extension + migration

**Files:**
- Modify: `server/src/db/schema.ts`
- Modify: `server/src/db/schema.test.ts`
- Create: `server/drizzle/0001_*.sql` (generated — commit all of `server/drizzle`)

**Interfaces:**
- Consumes: `EntryCategory` from `@planer/shared`.
- Produces: `shifts` with `category` (default `'shift'`), nullable `start`/`end`, `endDate`, `location`; `employees` with nullable `archivedAt`. Inferred `Shift`/`NewShift`/`Employee` types pick up the new columns.

- [ ] **Step 1: Write the failing test**

Add to `server/src/db/schema.test.ts` (extend the existing `describe`), importing `drizzle`/`Database` at the top if not already present:

```ts
it("shifts carries category, end_date, location, and nullable start/end", () => {
  const db = drizzle(new Database(":memory:"), { casing: "snake_case" });
  const sql = db.select().from(shifts).toSQL().sql;
  expect(sql).toContain("category");
  expect(sql).toContain("end_date");
  expect(sql).toContain("location");
});

it("employees carries archived_at", () => {
  const db = drizzle(new Database(":memory:"), { casing: "snake_case" });
  const sql = db.select().from(employees).toSQL().sql;
  expect(sql).toContain("archived_at");
});
```

(The file already imports `shifts` and `employees`; ensure `drizzle` from `drizzle-orm/better-sqlite3` and `Database` from `better-sqlite3` are imported — they are from Task-2/Plan-2 work; if not, add them.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `category`/`end_date`/`location`/`archived_at` not in the emitted SQL yet.

- [ ] **Step 3: Edit the schema**

In `server/src/db/schema.ts`:

Add the import at the top (next to the existing `SwapStatus` import):

```ts
import type { SwapStatus, EntryCategory } from "@planer/shared";
```

In the `shifts` table, change `start`/`end` to nullable and add three columns:

```ts
export const shifts = sqliteTable("shifts", {
  id: integer().primaryKey({ autoIncrement: true }),
  date: text().notNull(),
  start: text(),
  end: text(),
  endDate: text(),
  category: text().$type<EntryCategory>().notNull().default("shift"),
  location: text(),
  templateId: integer().references(() => shiftTemplates.id),
  title: text(),
  employeeId: integer().references(() => employees.id),
  note: text(),
  createdAt: createdAt(),
  updatedAt: createdAt().$onUpdate(() => new Date()),
});
```

In the `employees` table, add `archivedAt` (after `inviteToken`, before `createdAt`):

```ts
  archivedAt: integer({ mode: "timestamp" }),
```

- [ ] **Step 4: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: creates `server/drizzle/0001_*.sql` + updates `server/drizzle/meta/`.

Verify it contains the new columns:

Run: `grep -E "category|end_date|location|archived_at" server/drizzle/0001_*.sql`
Expected: matches for all four (as `ADD COLUMN` and/or in a recreated `shifts` table for the nullable start/end change).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the two new schema assertions green, and the whole suite still passes (the in-memory `makeTestDb` now applies migrations `0000` + `0001`; existing shift inserts with `start`/`end` still work, and the FK-enforcement / repo tests still pass against the migrated `shifts` table).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean. (`Shift.start`/`.end` are now `string | null`; confirm nothing in `server/src` dereferences them in a way that breaks — the existing repos/endpoints pass rows through untouched.)

- [ ] **Step 7: Commit**

```bash
git add server/src/db/schema.ts server/src/db/schema.test.ts server/drizzle
git commit -m "feat(server): schedule-entry categories + archivedAt migration"
```

---

### Task 3: Archive/restore repositories

**Files:**
- Modify: `server/src/repo/employees.ts`
- Test: `server/src/repo/archive.test.ts`

**Interfaces:**
- Consumes: `Db`, `employees`/`shifts` tables, `eq`/`and`/`gte` from `drizzle-orm`.
- Produces:
  - `archiveEmployee(db, id: number, fromDate: string): Employee | undefined` — sets `isActive=false`, `archivedAt=new Date()`, and unassigns (`employeeId=null`) that employee's shifts with `date >= fromDate`. Returns the updated employee (or `undefined` if no such id).
  - `restoreEmployee(db, id: number): Employee | undefined` — `isActive=true`, `archivedAt=null`.
  - `listArchived(db): Employee[]` — `isActive=false`.

- [ ] **Step 1: Write the failing test**

Create `server/src/repo/archive.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, listActive } from "./employees";
import { archiveEmployee, restoreEmployee, listArchived } from "./employees";
import { createShift, getShift, listUpcomingForEmployee } from "./shifts";

describe("archive / restore employee", () => {
  it("archives: deactivates, stamps archivedAt, unassigns future shifts, keeps past", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const future = createShift(db, { date: "2026-07-10", start: "08:00", end: "17:00", employeeId: anya.id });
    const past = createShift(db, { date: "2026-06-01", start: "08:00", end: "17:00", employeeId: anya.id });

    const archived = archiveEmployee(db, anya.id, "2026-07-05");
    expect(archived?.isActive).toBe(false);
    expect(archived?.archivedAt).toBeInstanceOf(Date);

    expect(getShift(db, future.id)?.employeeId).toBeNull();     // future unassigned
    expect(getShift(db, past.id)?.employeeId).toBe(anya.id);    // past kept
    expect(listActive(db).map((e) => e.id)).not.toContain(anya.id);
    expect(listArchived(db).map((e) => e.id)).toContain(anya.id);
  });

  it("restores: reactivates and clears archivedAt", () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Игорь", inviteToken: "tok" });
    linkTelegramAccount(db, "tok", 777);
    archiveEmployee(db, w.id, "2026-07-05");

    const restored = restoreEmployee(db, w.id);
    expect(restored?.isActive).toBe(true);
    expect(restored?.archivedAt).toBeNull();
    expect(listActive(db).map((e) => e.id)).toContain(w.id);
  });

  it("stores an all-day absence entry (vacation) with a date range and no times", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const vac = createShift(db, { date: "2026-07-10", endDate: "2026-07-20", category: "vacation", employeeId: anya.id });
    const row = getShift(db, vac.id);
    expect(row?.category).toBe("vacation");
    expect(row?.endDate).toBe("2026-07-20");
    expect(row?.start).toBeNull();
    expect(row?.end).toBeNull();
    // an absence is still the employee's row but is not a swappable shift (category drives that)
    expect(listUpcomingForEmployee(db, anya.id, "2026-07-01").map((s) => s.id)).toContain(vac.id);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `archiveEmployee` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `server/src/repo/employees.ts`. First ensure the imports at the top include `and`, `gte`, and the `shifts` table:

```ts
import { and, eq, gte } from "drizzle-orm";
import { employees, shifts, type Employee } from "../db/schema";
```

(Merge with the existing import lines — `employees.ts` already imports `eq` and `{ employees, ... }` from `../db/schema`; consolidate, don't duplicate.)

Then append:

```ts
export function archiveEmployee(db: Db, id: number, fromDate: string): Employee | undefined {
  db.update(shifts)
    .set({ employeeId: null })
    .where(and(eq(shifts.employeeId, id), gte(shifts.date, fromDate)))
    .run();
  return db
    .update(employees)
    .set({ isActive: false, archivedAt: new Date() })
    .where(eq(employees.id, id))
    .returning()
    .all()[0];
}

export function restoreEmployee(db: Db, id: number): Employee | undefined {
  return db
    .update(employees)
    .set({ isActive: true, archivedAt: null })
    .where(eq(employees.id, id))
    .returning()
    .all()[0];
}

export function listArchived(db: Db): Employee[] {
  return db.select().from(employees).where(eq(employees.isActive, false)).all();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `archive / restore employee` cases green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add server/src/repo/employees.ts server/src/repo/archive.test.ts
git commit -m "feat(server): archive/restore employee repos (soft-delete)"
```

---

## Done criteria

- `npm test` → all suites pass (shared + server, incl. category, schema, archive tests).
- `npm run typecheck` → clean.
- The migrated DB carries the category/endDate/location/archivedAt columns; archiving unassigns future shifts and preserves history; absences persist with a date range and null times.

## Notes for later plans

- Category-aware endpoints (create entry with category; team view coloring) + the admin "archive/restore user" UI land with the scheduling/admin plans; the balance calc will filter via `countsForBalance` when the fairness feature is built.
- The swap flow (Plan 6) must reject non-`shift` entries via `isSwappable` before calling `validateSwap`.

## Next plan

Plan 5 — **grammY bot + invite linking**: the bot skeleton (long-polling), `/start <invite_token>` → `linkTelegramAccount`, a "not registered" nudge for unknown users, and admin swap notifications wiring (stub until the swap endpoint exists).
