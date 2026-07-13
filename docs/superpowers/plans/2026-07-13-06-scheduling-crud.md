# Admin Scheduling CRUD — Implementation Plan (Plan 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins fill and edit the schedule: create / update / delete schedule entries (any category, with the FK-safe delete needed once swaps and reminders exist).

**Architecture:** Adds `updateShift` + a transactional cascade `deleteShift` to the shifts repo, a Zod input schema for entries (reusing `@planer/shared` category/time/date validators), and three admin-gated Hono endpoints wired to the repos. Tested via `app.request()` against migrated SQLite.

**Tech Stack:** Hono, Drizzle, Zod. Vitest.

Design spec: `docs/superpowers/specs/2026-07-13-shift-planner-telegram-bot-design.md` §7.2, §14.2. Builds on Plans 2–5.

## Global Constraints

- **Modules:** ESM; extensionless imports; `moduleResolution: "Bundler"`. TS `strict`, no `any` in source.
- **Auth:** all `/api/admin/*` routes are `requireAdmin` (401 no/bad token, 403 non-admin).
- **Entry = the `shifts` row** (any `EntryCategory`). Create/update accept: `date` (required), `category` (default `shift`), optional `start`/`end` (null for all-day absences), `endDate` (multi-day), `templateId`, `employeeId`, `location`, `title`, `note`.
- **FK-safe delete:** deleting a shift must first remove rows that FK-reference it (`reminder_log.shift_id`, `swap_requests.from_shift_id`/`to_shift_id`) in one transaction, then delete the shift — or the delete fails once those rows exist (FK enforcement is ON at runtime).
- **Commits:** one per task, conventional-commits.

## File Structure

```
server/src/
├── repo/shifts.ts       # + updateShift, deleteShift (cascade)
├── http/entry-schema.ts # createEntrySchema / updateEntrySchema (zod)
└── http/app.ts          # + POST/PATCH/DELETE /api/admin/entries
```

---

### Task 1: `updateShift` + cascade `deleteShift`

**Files:**
- Modify: `server/src/repo/shifts.ts`
- Test: `server/src/repo/shift-mutations.test.ts`

**Interfaces:**
- Consumes: `Db`, `shifts`/`swapRequests`/`reminderLog` tables, `eq`/`or` from `drizzle-orm`.
- Produces:
  - `updateShift(db, id: number, patch: Partial<NewShift>): Shift | undefined`
  - `deleteShift(db, id: number): boolean` — transactionally deletes referencing `swap_requests` + `reminder_log` rows, then the shift; returns whether a shift was deleted.

- [ ] **Step 1: Write the failing test**

Create `server/src/repo/shift-mutations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "./employees";
import { createShift, getShift, updateShift, deleteShift } from "./shifts";
import { swapRequests, reminderLog } from "../db/schema";

describe("updateShift", () => {
  it("patches fields and bumps updatedAt", () => {
    const db = makeTestDb();
    const s = createShift(db, { date: "2026-07-10", start: "08:00", end: "17:00" });
    const updated = updateShift(db, s.id, { category: "vacation", start: null, end: null, endDate: "2026-07-20" });
    expect(updated?.category).toBe("vacation");
    expect(updated?.start).toBeNull();
    expect(updated?.endDate).toBe("2026-07-20");
  });

  it("returns undefined for an unknown id", () => {
    expect(updateShift(makeTestDb(), 999, { note: "x" })).toBeUndefined();
  });
});

describe("deleteShift (FK-safe cascade)", () => {
  it("deletes the shift and its referencing swap/reminder rows", () => {
    const db = makeTestDb();
    const a = createEmployee(db, { displayName: "Аня" });
    const b = createEmployee(db, { displayName: "Игорь" });
    const s1 = createShift(db, { date: "2026-07-10", start: "08:00", end: "17:00", employeeId: a.id });
    const s2 = createShift(db, { date: "2026-07-11", start: "11:00", end: "20:00", employeeId: b.id });
    // rows that FK-reference s1
    db.insert(swapRequests).values({ fromEmployeeId: a.id, fromShiftId: s1.id, toEmployeeId: b.id, toShiftId: s2.id }).run();
    db.insert(reminderLog).values({ shiftId: s1.id, kind: "evening_before" }).run();

    expect(deleteShift(db, s1.id)).toBe(true);
    expect(getShift(db, s1.id)).toBeUndefined();          // shift gone
    expect(getShift(db, s2.id)?.id).toBe(s2.id);          // other shift kept
    expect(db.select().from(swapRequests).all().length).toBe(0);  // referencing swap removed
    expect(db.select().from(reminderLog).all().length).toBe(0);   // reminder removed
  });

  it("returns false for an unknown id", () => {
    expect(deleteShift(makeTestDb(), 999)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `updateShift`/`deleteShift` not exported.

- [ ] **Step 3: Write the implementation**

In `server/src/repo/shifts.ts`, update the imports and append the two functions. The import line becomes:

```ts
import { and, eq, gte, lte, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { shifts, swapRequests, reminderLog, type Shift, type NewShift } from "../db/schema";
```

(Merge with the existing imports — add `or` to `drizzle-orm`, and `swapRequests`/`reminderLog` to the schema import; don't duplicate lines.)

Append:

```ts
export function updateShift(db: Db, id: number, patch: Partial<NewShift>): Shift | undefined {
  return db.update(shifts).set(patch).where(eq(shifts.id, id)).returning().all()[0];
}

export function deleteShift(db: Db, id: number): boolean {
  return db.transaction((tx) => {
    tx.delete(swapRequests).where(or(eq(swapRequests.fromShiftId, id), eq(swapRequests.toShiftId, id))).run();
    tx.delete(reminderLog).where(eq(reminderLog.shiftId, id)).run();
    return tx.delete(shifts).where(eq(shifts.id, id)).returning().all().length > 0;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `updateShift` / `deleteShift` cases green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add server/src/repo/shifts.ts server/src/repo/shift-mutations.test.ts
git commit -m "feat(server): updateShift + FK-safe cascade deleteShift"
```

---

### Task 2: Entry input schema

**Files:**
- Create: `server/src/http/entry-schema.ts`
- Test: `server/src/http/entry-schema.test.ts`

**Interfaces:**
- Consumes: `zod`; `entryCategorySchema`, `timeStr`, `dateStr` from `@planer/shared`.
- Produces: `createEntrySchema` (date required, category default `shift`, other fields optional/nullable) and `updateEntrySchema` (all optional); their inferred output is assignable to `Partial<NewShift>`.

- [ ] **Step 1: Write the failing test**

Create `server/src/http/entry-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createEntrySchema, updateEntrySchema } from "./entry-schema";

describe("entry input schema", () => {
  it("parses a regular shift with a template", () => {
    const r = createEntrySchema.parse({ date: "2026-07-10", start: "08:00", end: "17:00", employeeId: 5, templateId: 1 });
    expect(r.category).toBe("shift"); // default
    expect(r.employeeId).toBe(5);
  });

  it("parses an all-day vacation with a range and no times", () => {
    const r = createEntrySchema.parse({ date: "2026-07-10", endDate: "2026-07-20", category: "vacation" });
    expect(r.category).toBe("vacation");
    expect(r.endDate).toBe("2026-07-20");
  });

  it("rejects a bad category, date, or time", () => {
    expect(createEntrySchema.safeParse({ date: "2026-07-10", category: "bogus" }).success).toBe(false);
    expect(createEntrySchema.safeParse({ date: "10-07-2026" }).success).toBe(false);
    expect(createEntrySchema.safeParse({ date: "2026-07-10", start: "8am" }).success).toBe(false);
  });

  it("update schema makes everything optional", () => {
    expect(updateEntrySchema.parse({ note: "заметка" })).toEqual({ note: "заметка" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./entry-schema`.

- [ ] **Step 3: Write the implementation**

Create `server/src/http/entry-schema.ts`:

```ts
import { z } from "zod";
import { entryCategorySchema, timeStr, dateStr } from "@planer/shared";

export const createEntrySchema = z.object({
  date: dateStr,
  category: entryCategorySchema.default("shift"),
  start: timeStr.nullish(),
  end: timeStr.nullish(),
  endDate: dateStr.nullish(),
  templateId: z.number().int().nullish(),
  employeeId: z.number().int().nullish(),
  location: z.string().nullish(),
  title: z.string().nullish(),
  note: z.string().nullish(),
});

export const updateEntrySchema = createEntrySchema.partial();

export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `entry input schema` cases green.

- [ ] **Step 5: Commit**

```bash
git add server/src/http/entry-schema.ts server/src/http/entry-schema.test.ts
git commit -m "feat(server): zod input schema for schedule entries"
```

---

### Task 3: Admin entry endpoints

**Files:**
- Modify: `server/src/http/app.ts`
- Test: `server/src/http/entries.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`; `createShift`, `updateShift`, `deleteShift`, `getShift`; `createEntrySchema`, `updateEntrySchema`.
- Produces routes:
  - `POST /api/admin/entries` (admin) → 201 `{ entry }` | 400 `{ error, issues }`
  - `PATCH /api/admin/entries/:id` (admin) → `{ entry }` | 404 | 400
  - `DELETE /api/admin/entries/:id` (admin) → `{ ok: true }` | 404

- [ ] **Step 1: Write the failing test**

Create `server/src/http/entries.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { getShift } from "../repo/shifts";
import { signInitData } from "../auth/telegram";
import type { Config } from "../config";

const config: Config = {
  botToken: "12345:tok", adminTelegramIds: [111], teamTz: "Europe/Moscow",
  databaseUrl: ":memory:", jwtSecret: "test-jwt-secret-that-is-long-enough-0123", publicUrl: "https://x.keenetic.pro",
};
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;
const authedJson = (t: string, body: unknown, method = "POST") => ({
  method, headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("admin entry endpoints", () => {
  it("creates, updates, and deletes an entry (admin only)", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const created = await app.request("/api/admin/entries", authedJson(admin, { date: "2026-07-10", start: "08:00", end: "17:00", employeeId: anya.id }));
    expect(created.status).toBe(201);
    const id = (await created.json()).entry.id as number;
    expect(getShift(db, id)?.employeeId).toBe(anya.id);

    const patched = await app.request(`/api/admin/entries/${id}`, authedJson(admin, { category: "duty", location: "Вавилова" }, "PATCH"));
    expect(patched.status).toBe(200);
    expect((await patched.json()).entry.category).toBe("duty");

    const del = await app.request(`/api/admin/entries/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${admin}` } });
    expect(del.status).toBe(200);
    expect(getShift(db, id)).toBeUndefined();
  });

  it("rejects a worker (403) and validates the body (400)", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Игорь", inviteToken: "tok" });
    linkTelegramAccount(db, "tok", 333);
    const app = createApp({ db, config });

    const worker = await tokenFor(app, 333);
    const forbidden = await app.request("/api/admin/entries", authedJson(worker, { date: "2026-07-10" }));
    expect(forbidden.status).toBe(403);

    const admin = await tokenFor(app, 111);
    const bad = await app.request("/api/admin/entries", authedJson(admin, { date: "nope" }));
    expect(bad.status).toBe(400);

    const missing = await app.request("/api/admin/entries/999", authedJson(admin, { note: "x" }, "PATCH"));
    expect(missing.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — routes 404.

- [ ] **Step 3: Add the routes**

In `server/src/http/app.ts`, add to the imports (merge with existing lines, no duplicates):

```ts
import { getByTelegramId, getEmployeeById, createAdminEmployee, listActive } from "../repo/employees";
import { createShift, updateShift, deleteShift } from "../repo/shifts";
import { listUpcomingForEmployee, listShiftsInRange } from "../repo/shifts";
import { createEntrySchema, updateEntrySchema } from "./entry-schema";
```

(Note: `../repo/shifts` already provides `listUpcomingForEmployee`/`listShiftsInRange` — consolidate all three shift imports into ONE `from "../repo/shifts"` line: `createShift, updateShift, deleteShift, listUpcomingForEmployee, listShiftsInRange`.)

Inside `createApp`, before `return app;`, add:

```ts
  app.post("/api/admin/entries", requireAdmin(config.jwtSecret), async (c) => {
    const parsed = createEntrySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    return c.json({ entry: createShift(db, parsed.data) }, 201);
  });

  app.patch("/api/admin/entries/:id", requireAdmin(config.jwtSecret), async (c) => {
    const id = Number(c.req.param("id"));
    const parsed = updateEntrySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    const entry = updateShift(db, id, parsed.data);
    if (!entry) return c.json({ error: "not_found" }, 404);
    return c.json({ entry });
  });

  app.delete("/api/admin/entries/:id", requireAdmin(config.jwtSecret), (c) => {
    const id = Number(c.req.param("id"));
    if (!deleteShift(db, id)) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `admin entry endpoints` cases green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean. (If `createEntrySchema`'s inferred type isn't directly assignable to `createShift`'s `NewShift` param — e.g. `nullish` producing `undefined` — narrow at the call site or accept `Partial<NewShift>` in `createShift`; make the minimal change to keep it clean.)

- [ ] **Step 6: Commit**

```bash
git add server/src/http/app.ts server/src/http/entries.test.ts
git commit -m "feat(server): admin schedule entry endpoints (create/update/delete)"
```

---

## Done criteria

- `npm test` → all suites pass; `npm run typecheck` → clean.
- Admin can create/update/delete entries; deleting an entry FK-safely removes its swap/reminder references; non-admins get 403; bad bodies get 400; unknown ids 404.

## Notes for later plans

- The swap flow (Plan 7) creates `swap_requests` and calls `notifyUser`/`notifyAdmins`; deleting a shift with a PENDING swap currently just removes the request — Plan 7 should additionally notify the affected worker ("заявка неактуальна", per spec §7.3).
- "Copy previous week" and the fair auto-distribute build on `createShift`/unassigned slots later.

## Next plan

Plan 7 — **Swap flow end-to-end**: `POST /api/swaps` (create request, guarded by `isSwappable`), accept/decline/cancel, the transactional exchange via `validateSwap` + `nextSwapStatus`, auto-cancel of sibling pending requests, `notifyUser`/`notifyAdmins` wiring, and the bot's inline [Принять]/[Отклонить] callback handlers.
