# Foundation + Domain Core — Implementation Plan (Plan 1 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo and build the pure, fully unit-tested domain core (`@planer/shared`): time model, shift-overlap detection, swap validation + state machine, and balance computation.

**Architecture:** npm-workspaces monorepo (variant A from the spec). This plan delivers only the `shared` package — pure TypeScript functions with **zero I/O** (no DB, no Telegram, no HTTP), so every rule is testable in isolation. Later plans (server, admin, miniapp) import these functions and add the adapters around them.

**Tech Stack:** TypeScript (ESM, strict), Vitest for tests, Zod for schemas. No runtime framework in this plan.

Design spec: `docs/superpowers/specs/2026-07-13-shift-planner-telegram-bot-design.md`

## Global Constraints

- **Runtime:** Node.js ≥ 20 (LTS). Dev machine is macOS; deploy target is Raspberry Pi 4 (arm64) — keep everything arm-friendly.
- **Modules:** ESM everywhere (`"type": "module"`). `moduleResolution: "Bundler"`, extensionless relative imports (`./time`, not `./time.js`).
- **TypeScript:** `strict: true`. No `any` in committed code.
- **Package manager:** npm workspaces (no pnpm/yarn required — minimize prerequisites).
- **Naming:** code identifiers in English; user-facing copy in Russian (none in this plan — pure logic only).
- **Timezone:** team wall-clock timezone default `Europe/Moscow` (config later). Domain functions are timezone-agnostic: callers pass wall-clock `{date, time}` values; functions never call the system clock.
- **Purity:** `@planer/shared` must not import any I/O, framework, or Node built-in beyond pure computation. No `Date.now()` inside logic — current time is always passed in as a parameter.
- **Commits:** one per task, conventional-commits style.

## File Structure

```
planer-bot/
├── package.json              # root: workspaces, scripts, dev deps
├── tsconfig.base.json        # shared compiler options
├── vitest.config.ts          # test runner config
└── shared/
    ├── package.json          # @planer/shared, dep: zod
    ├── tsconfig.json         # extends base
    └── src/
        ├── index.ts          # public barrel (re-exports)
        ├── types.ts          # Zod schemas + inferred types (Employee, Shift, ShiftTemplate, SwapStatus…)
        ├── time.ts           # toMinutes, dayNumber, dayOfWeek, resolveShiftTimes, shiftDurationHours, isNightShift, isWeekend
        ├── overlap.ts        # shiftInterval, shiftsOverlap
        ├── swap.ts           # nextSwapStatus (state machine), validateSwap
        └── balance.ts        # computeBalance
```

Each module has one responsibility and its own `*.test.ts` colocated in `src/`.

---

## Prerequisites (one-time, before Task 1)

Node.js is **not installed** on this machine (verified: no `node`, `brew`, `nvm`). Install it once. Recommended no-sudo path via `fnm` (single binary):

```bash
# install fnm (Fast Node Manager) into ~/.local/bin
curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir "$HOME/.local/bin" --skip-shell
export PATH="$HOME/.local/bin:$PATH"
eval "$(fnm env)"
fnm install 22
fnm use 22
node -v   # expect: v22.x
npm -v    # expect: 10.x
```

Alternative: official installer from https://nodejs.org (LTS `.pkg`). Either is fine; the rest of the plan only needs `node` + `npm` on `PATH`.

---

### Task 1: Monorepo scaffold + Vitest

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Test: `shared/src/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test` command and the `@planer/shared` workspace that later tasks add modules to.

- [ ] **Step 1: Write the failing test**

Create `shared/src/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("toolchain smoke test", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `npm` errors that `vitest` is not found / no `package.json` yet (toolchain not set up). This confirms we start from nothing.

- [ ] **Step 3: Create the scaffold files**

Create `package.json`:

```json
{
  "name": "planer-bot",
  "private": true,
  "type": "module",
  "workspaces": ["shared"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p shared/tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  }
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/src/**/*.test.ts"],
    environment: "node",
  },
});
```

Create `shared/package.json`:

```json
{
  "name": "@planer/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "zod": "^3.23.0"
  }
}
```

Create `shared/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: creates `node_modules/` and `package-lock.json` with no errors.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 1 test passed (`toolchain smoke test`).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json vitest.config.ts shared/
git commit -m "chore: monorepo scaffold with vitest and @planer/shared workspace"
```

---

### Task 2: Domain types & Zod schemas

**Files:**
- Create: `shared/src/types.ts`
- Create: `shared/src/index.ts`
- Test: `shared/src/types.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces:
  - Types: `Employee`, `ShiftTemplate`, `Shift`, `SwapStatus`, `SwapEvent`.
  - Schemas: `shiftTemplateSchema`, `shiftSchema`, `employeeSchema`, `swapStatusSchema`.
  - Field shapes used by every later task: `Shift = { id:number; date:string; start:string; end:string; templateId:number|null; title:string|null; employeeId:number|null; note:string|null }`; times are `"HH:MM"`, dates `"YYYY-MM-DD"`.

- [ ] **Step 1: Write the failing test**

Create `shared/src/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shiftSchema, shiftTemplateSchema, swapStatusSchema } from "./types";

describe("schemas", () => {
  it("accepts a valid shift", () => {
    const shift = {
      id: 1, date: "2026-07-05", start: "08:00", end: "15:45",
      templateId: 3, title: "Утро", employeeId: 7, note: null,
    };
    expect(shiftSchema.parse(shift)).toEqual(shift);
  });

  it("rejects a malformed time", () => {
    const bad = { id: 1, date: "2026-07-05", start: "8:00", end: "17:00",
      templateId: null, title: null, employeeId: null, note: null };
    expect(shiftSchema.safeParse(bad).success).toBe(false);
  });

  it("resolves the friday override fields on a template", () => {
    const tpl = shiftTemplateSchema.parse({
      id: 3, name: "Утро", start: "08:00", end: "17:00",
      fridayStart: "08:00", fridayEnd: "15:45",
      isLate: false, sendReminder: true, sortOrder: 0, isActive: true,
    });
    expect(tpl.fridayEnd).toBe("15:45");
  });

  it("enumerates swap statuses", () => {
    expect(swapStatusSchema.parse("pending")).toBe("pending");
    expect(swapStatusSchema.safeParse("bogus").success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./types`.

- [ ] **Step 3: Write the implementation**

Create `shared/src/types.ts`:

```ts
import { z } from "zod";

/** "HH:MM" 24h wall-clock. */
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");
/** "YYYY-MM-DD". */
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const employeeSchema = z.object({
  id: z.number().int(),
  telegramUserId: z.number().int().nullable(),
  tgUsername: z.string().nullable(),
  displayName: z.string().min(1),
  phone: z.string().nullable(),
  isAdmin: z.boolean(),
  isActive: z.boolean(),
  remindersEnabled: z.boolean(),
  prepBufferMin: z.number().int().nonnegative(),
});
export type Employee = z.infer<typeof employeeSchema>;

export const shiftTemplateSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  start: timeStr,
  end: timeStr,
  fridayStart: timeStr.nullable(),
  fridayEnd: timeStr.nullable(),
  isLate: z.boolean(),
  sendReminder: z.boolean(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export type ShiftTemplate = z.infer<typeof shiftTemplateSchema>;

export const shiftSchema = z.object({
  id: z.number().int(),
  date: dateStr,
  start: timeStr,
  end: timeStr,
  templateId: z.number().int().nullable(),
  title: z.string().nullable(),
  employeeId: z.number().int().nullable(),
  note: z.string().nullable(),
});
export type Shift = z.infer<typeof shiftSchema>;

export const swapStatusSchema = z.enum([
  "pending", "accepted", "declined", "cancelled", "expired",
]);
export type SwapStatus = z.infer<typeof swapStatusSchema>;

export type SwapEvent = "accept" | "decline" | "cancel" | "expire";
```

Create `shared/src/index.ts`:

```ts
export * from "./types";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `schemas` tests green.

- [ ] **Step 5: Commit**

```bash
git add shared/src/types.ts shared/src/index.ts shared/src/types.test.ts
git commit -m "feat(shared): domain types and zod schemas"
```

---

### Task 3: Time module

**Files:**
- Create: `shared/src/time.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/src/time.test.ts`

**Interfaces:**
- Consumes: `ShiftTemplate` from `./types`.
- Produces:
  - `toMinutes(t: string): number`
  - `dayNumber(date: string): number` — whole days since epoch (for interval math)
  - `dayOfWeek(date: string): number` — 0=Sun … 6=Sat
  - `resolveShiftTimes(tpl: ShiftTemplate, date: string): { start: string; end: string }`
  - `shiftDurationHours(shift: { start: string; end: string }): number`
  - `isNightShift(shift: { start: string; end: string }): boolean`
  - `isWeekend(date: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `shared/src/time.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  toMinutes, dayOfWeek, resolveShiftTimes, shiftDurationHours, isNightShift, isWeekend,
} from "./time";
import type { ShiftTemplate } from "./types";

const evening: ShiftTemplate = {
  id: 3, name: "Вечер", start: "11:00", end: "20:00",
  fridayStart: "12:00", fridayEnd: "20:00",
  isLate: true, sendReminder: false, sortOrder: 2, isActive: true,
};

describe("time", () => {
  it("converts HH:MM to minutes", () => {
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("15:45")).toBe(945);
  });

  it("computes day of week (2026-07-05 is Sunday)", () => {
    expect(dayOfWeek("2026-07-05")).toBe(0); // Sunday
    expect(dayOfWeek("2026-07-03")).toBe(5); // Friday
  });

  it("uses the friday override on fridays only", () => {
    expect(resolveShiftTimes(evening, "2026-07-03")).toEqual({ start: "12:00", end: "20:00" }); // Fri
    expect(resolveShiftTimes(evening, "2026-07-02")).toEqual({ start: "11:00", end: "20:00" }); // Wed
  });

  it("computes duration, handling overnight", () => {
    expect(shiftDurationHours({ start: "15:00", end: "23:00" })).toBe(8);
    expect(shiftDurationHours({ start: "23:00", end: "07:00" })).toBe(8); // overnight
  });

  it("detects night shifts (end >= 22:00 or overnight)", () => {
    expect(isNightShift({ start: "15:00", end: "23:00" })).toBe(true);
    expect(isNightShift({ start: "11:00", end: "20:00" })).toBe(false); // evening, not night
    expect(isNightShift({ start: "23:00", end: "07:00" })).toBe(true);
  });

  it("detects weekends", () => {
    expect(isWeekend("2026-07-05")).toBe(true);  // Sun
    expect(isWeekend("2026-07-04")).toBe(true);  // Sat
    expect(isWeekend("2026-07-03")).toBe(false); // Fri
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./time`.

- [ ] **Step 3: Write the implementation**

Create `shared/src/time.ts`:

```ts
import type { ShiftTemplate } from "./types";

const MINUTES_PER_DAY = 24 * 60;

export function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Whole days since the Unix epoch for a YYYY-MM-DD wall-clock date. */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. Computed via UTC to avoid local-tz drift. */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function resolveShiftTimes(tpl: ShiftTemplate, date: string): { start: string; end: string } {
  const isFriday = dayOfWeek(date) === 5;
  if (isFriday && tpl.fridayStart && tpl.fridayEnd) {
    return { start: tpl.fridayStart, end: tpl.fridayEnd };
  }
  return { start: tpl.start, end: tpl.end };
}

export function shiftDurationHours(shift: { start: string; end: string }): number {
  let mins = toMinutes(shift.end) - toMinutes(shift.start);
  if (mins <= 0) mins += MINUTES_PER_DAY; // overnight shift ends next day
  return mins / 60;
}

/** Night = ends at/after 22:00, or crosses midnight. Reliable for our shift types. */
export function isNightShift(shift: { start: string; end: string }): boolean {
  const start = toMinutes(shift.start);
  const end = toMinutes(shift.end);
  return end <= start || end >= 22 * 60;
}

export function isWeekend(date: string): boolean {
  const dow = dayOfWeek(date);
  return dow === 0 || dow === 6;
}
```

Append to `shared/src/index.ts`:

```ts
export * from "./time";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `time` tests green.

- [ ] **Step 5: Commit**

```bash
git add shared/src/time.ts shared/src/time.test.ts shared/src/index.ts
git commit -m "feat(shared): shift time model (resolve, duration, night, weekend)"
```

---

### Task 4: Overlap module

**Files:**
- Create: `shared/src/overlap.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/src/overlap.test.ts`

**Interfaces:**
- Consumes: `toMinutes`, `dayNumber`, `shiftDurationHours` from `./time`.
- Produces:
  - `shiftInterval(shift: { date: string; start: string; end: string }): { start: number; end: number }` — absolute minutes since epoch.
  - `shiftsOverlap(a, b): boolean` where both args are `{ date; start; end }`.

- [ ] **Step 1: Write the failing test**

Create `shared/src/overlap.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shiftsOverlap } from "./overlap";

const s = (date: string, start: string, end: string) => ({ date, start, end });

describe("shiftsOverlap", () => {
  it("is false for shifts on different days", () => {
    expect(shiftsOverlap(s("2026-07-05", "09:00", "17:00"), s("2026-07-06", "09:00", "17:00"))).toBe(false);
  });

  it("is true for same-day overlapping shifts", () => {
    expect(shiftsOverlap(s("2026-07-05", "09:00", "17:00"), s("2026-07-05", "16:00", "20:00"))).toBe(true);
  });

  it("is false for adjacent (touching) shifts", () => {
    expect(shiftsOverlap(s("2026-07-05", "09:00", "17:00"), s("2026-07-05", "17:00", "23:00"))).toBe(false);
  });

  it("detects an overnight shift bleeding into the next day", () => {
    expect(shiftsOverlap(s("2026-07-05", "23:00", "07:00"), s("2026-07-06", "06:00", "14:00"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./overlap`.

- [ ] **Step 3: Write the implementation**

Create `shared/src/overlap.ts`:

```ts
import { toMinutes, dayNumber, shiftDurationHours } from "./time";

type TimedShift = { date: string; start: string; end: string };

/** Absolute [start, end) in minutes since epoch, so overnight & cross-day math just works. */
export function shiftInterval(shift: TimedShift): { start: number; end: number } {
  const start = dayNumber(shift.date) * 24 * 60 + toMinutes(shift.start);
  const end = start + Math.round(shiftDurationHours(shift) * 60);
  return { start, end };
}

export function shiftsOverlap(a: TimedShift, b: TimedShift): boolean {
  const ia = shiftInterval(a);
  const ib = shiftInterval(b);
  return ia.start < ib.end && ib.start < ia.end;
}
```

Append to `shared/src/index.ts`:

```ts
export * from "./overlap";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `shiftsOverlap` tests green.

- [ ] **Step 5: Commit**

```bash
git add shared/src/overlap.ts shared/src/overlap.test.ts shared/src/index.ts
git commit -m "feat(shared): shift overlap / double-booking detection"
```

---

### Task 5: Swap state machine

**Files:**
- Create: `shared/src/swap.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/src/swap.test.ts`

**Interfaces:**
- Consumes: `SwapStatus`, `SwapEvent` from `./types`.
- Produces: `nextSwapStatus(current: SwapStatus, event: SwapEvent): SwapStatus` (throws on an invalid transition).

- [ ] **Step 1: Write the failing test**

Create `shared/src/swap.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextSwapStatus } from "./swap";

describe("nextSwapStatus", () => {
  it("moves pending → accepted on accept", () => {
    expect(nextSwapStatus("pending", "accept")).toBe("accepted");
  });

  it("moves pending → declined / cancelled / expired", () => {
    expect(nextSwapStatus("pending", "decline")).toBe("declined");
    expect(nextSwapStatus("pending", "cancel")).toBe("cancelled");
    expect(nextSwapStatus("pending", "expire")).toBe("expired");
  });

  it("throws when acting on an already-resolved request", () => {
    expect(() => nextSwapStatus("accepted", "accept")).toThrow();
    expect(() => nextSwapStatus("declined", "cancel")).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./swap`.

- [ ] **Step 3: Write the implementation**

Create `shared/src/swap.ts`:

```ts
import type { SwapStatus, SwapEvent } from "./types";

const TRANSITIONS: Record<SwapStatus, Partial<Record<SwapEvent, SwapStatus>>> = {
  pending: { accept: "accepted", decline: "declined", cancel: "cancelled", expire: "expired" },
  accepted: {},
  declined: {},
  cancelled: {},
  expired: {},
};

export function nextSwapStatus(current: SwapStatus, event: SwapEvent): SwapStatus {
  const next = TRANSITIONS[current][event];
  if (!next) {
    throw new Error(`Invalid swap transition: "${current}" + "${event}"`);
  }
  return next;
}
```

Append to `shared/src/index.ts`:

```ts
export * from "./swap";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `nextSwapStatus` tests green.

- [ ] **Step 5: Commit**

```bash
git add shared/src/swap.ts shared/src/swap.test.ts shared/src/index.ts
git commit -m "feat(shared): swap request state machine"
```

---

### Task 6: Swap validation

**Files:**
- Modify: `shared/src/swap.ts`
- Test: `shared/src/swap-validate.test.ts`

**Interfaces:**
- Consumes: `Shift` from `./types`; `shiftInterval`, `shiftsOverlap` from `./overlap`; `dayNumber`, `toMinutes` from `./time`.
- Produces:
  - `type SwapValidation = { ok: true } | { ok: false; reason: SwapRejectReason }`
  - `type SwapRejectReason = "from-shift-not-owned" | "to-shift-not-owned" | "from-shift-in-past" | "to-shift-in-past" | "double-booking-from" | "double-booking-to"`
  - `validateSwap(ctx: SwapContext): SwapValidation` where
    `SwapContext = { fromShift: Shift; toShift: Shift; fromEmployeeId: number; toEmployeeId: number; fromOtherShifts: Shift[]; toOtherShifts: Shift[]; now: { date: string; time: string } }`.
    `fromOtherShifts`/`toOtherShifts` exclude the two shifts being swapped.

- [ ] **Step 1: Write the failing test**

Create `shared/src/swap-validate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateSwap } from "./swap";
import type { Shift } from "./types";

const shift = (over: Partial<Shift>): Shift => ({
  id: 0, date: "2026-07-10", start: "09:00", end: "18:00",
  templateId: null, title: null, employeeId: null, note: null, ...over,
});

const now = { date: "2026-07-01", time: "12:00" };

describe("validateSwap", () => {
  const from = shift({ id: 1, date: "2026-07-10", employeeId: 100 });
  const to = shift({ id: 2, date: "2026-07-11", employeeId: 200 });

  it("accepts a clean swap", () => {
    const r = validateSwap({
      fromShift: from, toShift: to, fromEmployeeId: 100, toEmployeeId: 200,
      fromOtherShifts: [], toOtherShifts: [], now,
    });
    expect(r).toEqual({ ok: true });
  });

  it("rejects when the shift is no longer owned by the initiator", () => {
    const r = validateSwap({
      fromShift: { ...from, employeeId: 999 }, toShift: to,
      fromEmployeeId: 100, toEmployeeId: 200,
      fromOtherShifts: [], toOtherShifts: [], now,
    });
    expect(r).toEqual({ ok: false, reason: "from-shift-not-owned" });
  });

  it("rejects a swap of a past shift", () => {
    const r = validateSwap({
      fromShift: { ...from, date: "2026-06-01" }, toShift: to,
      fromEmployeeId: 100, toEmployeeId: 200,
      fromOtherShifts: [], toOtherShifts: [], now,
    });
    expect(r).toEqual({ ok: false, reason: "from-shift-in-past" });
  });

  it("rejects when the initiator would be double-booked", () => {
    // initiator (100) already has a shift on 2026-07-11 that overlaps `to`
    const clash = shift({ id: 3, date: "2026-07-11", start: "10:00", end: "16:00", employeeId: 100 });
    const r = validateSwap({
      fromShift: from, toShift: to, fromEmployeeId: 100, toEmployeeId: 200,
      fromOtherShifts: [clash], toOtherShifts: [], now,
    });
    expect(r).toEqual({ ok: false, reason: "double-booking-from" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `validateSwap` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `shared/src/swap.ts`:

```ts
import type { Shift } from "./types";
import { shiftsOverlap, shiftInterval } from "./overlap";
import { dayNumber, toMinutes } from "./time";

export type SwapRejectReason =
  | "from-shift-not-owned"
  | "to-shift-not-owned"
  | "from-shift-in-past"
  | "to-shift-in-past"
  | "double-booking-from"
  | "double-booking-to";

export type SwapValidation = { ok: true } | { ok: false; reason: SwapRejectReason };

export interface SwapContext {
  fromShift: Shift;
  toShift: Shift;
  fromEmployeeId: number;
  toEmployeeId: number;
  /** initiator's other shifts (excluding fromShift) */
  fromOtherShifts: Shift[];
  /** counterparty's other shifts (excluding toShift) */
  toOtherShifts: Shift[];
  /** current team wall-clock time */
  now: { date: string; time: string };
}

export function validateSwap(ctx: SwapContext): SwapValidation {
  const { fromShift, toShift, fromEmployeeId, toEmployeeId, fromOtherShifts, toOtherShifts, now } = ctx;

  if (fromShift.employeeId !== fromEmployeeId) return { ok: false, reason: "from-shift-not-owned" };
  if (toShift.employeeId !== toEmployeeId) return { ok: false, reason: "to-shift-not-owned" };

  const nowAbs = dayNumber(now.date) * 24 * 60 + toMinutes(now.time);
  if (shiftInterval(fromShift).start <= nowAbs) return { ok: false, reason: "from-shift-in-past" };
  if (shiftInterval(toShift).start <= nowAbs) return { ok: false, reason: "to-shift-in-past" };

  // After the swap: initiator works `toShift`, counterparty works `fromShift`.
  if (fromOtherShifts.some((s) => shiftsOverlap(s, toShift))) return { ok: false, reason: "double-booking-from" };
  if (toOtherShifts.some((s) => shiftsOverlap(s, fromShift))) return { ok: false, reason: "double-booking-to" };

  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `validateSwap` tests green.

- [ ] **Step 5: Commit**

```bash
git add shared/src/swap.ts shared/src/swap-validate.test.ts
git commit -m "feat(shared): swap validation (ownership, future, double-booking)"
```

---

### Task 7: Balance computation

**Files:**
- Create: `shared/src/balance.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/src/balance.test.ts`

**Interfaces:**
- Consumes: `shiftDurationHours`, `isNightShift`, `isWeekend` from `./time`.
- Produces:
  - `interface ShiftForBalance { employeeId: number; date: string; start: string; end: string; isLate: boolean }`
  - `interface EmployeeBalance { employeeId: number; hours: number; nights: number; weekends: number; lateShifts: number }`
  - `computeBalance(shifts: ShiftForBalance[], employeeIds: number[]): EmployeeBalance[]` — one row per id (including zero-shift employees), preserving input id order.

- [ ] **Step 1: Write the failing test**

Create `shared/src/balance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeBalance, type ShiftForBalance } from "./balance";

const shifts: ShiftForBalance[] = [
  { employeeId: 1, date: "2026-07-01", start: "08:00", end: "17:00", isLate: false }, // Wed, 9h
  { employeeId: 1, date: "2026-07-04", start: "15:00", end: "23:00", isLate: true },  // Sat night, 8h
  { employeeId: 2, date: "2026-07-01", start: "11:00", end: "20:00", isLate: true },  // Wed evening, 9h
];

describe("computeBalance", () => {
  it("aggregates hours, nights, weekends, late shifts per employee", () => {
    const result = computeBalance(shifts, [1, 2]);
    expect(result).toEqual([
      { employeeId: 1, hours: 17, nights: 1, weekends: 1, lateShifts: 1 },
      { employeeId: 2, hours: 9, nights: 0, weekends: 0, lateShifts: 1 },
    ]);
  });

  it("includes employees with no shifts as zero rows", () => {
    const result = computeBalance([], [5]);
    expect(result).toEqual([{ employeeId: 5, hours: 0, nights: 0, weekends: 0, lateShifts: 0 }]);
  });

  it("ignores shifts for employees not in the id list", () => {
    const result = computeBalance([{ employeeId: 99, date: "2026-07-01", start: "08:00", end: "17:00", isLate: false }], [1]);
    expect(result).toEqual([{ employeeId: 1, hours: 0, nights: 0, weekends: 0, lateShifts: 0 }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./balance`.

- [ ] **Step 3: Write the implementation**

Create `shared/src/balance.ts`:

```ts
import { shiftDurationHours, isNightShift, isWeekend } from "./time";

export interface ShiftForBalance {
  employeeId: number;
  date: string;
  start: string;
  end: string;
  isLate: boolean;
}

export interface EmployeeBalance {
  employeeId: number;
  hours: number;
  nights: number;
  weekends: number;
  lateShifts: number;
}

export function computeBalance(shifts: ShiftForBalance[], employeeIds: number[]): EmployeeBalance[] {
  const byId = new Map<number, EmployeeBalance>();
  for (const id of employeeIds) {
    byId.set(id, { employeeId: id, hours: 0, nights: 0, weekends: 0, lateShifts: 0 });
  }
  for (const s of shifts) {
    const row = byId.get(s.employeeId);
    if (!row) continue;
    row.hours += shiftDurationHours(s);
    if (isNightShift(s)) row.nights += 1;
    if (isWeekend(s.date)) row.weekends += 1;
    if (s.isLate) row.lateShifts += 1;
  }
  return employeeIds.map((id) => byId.get(id)!);
}
```

Append to `shared/src/index.ts`:

```ts
export * from "./balance";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `computeBalance` tests green (and the full suite: 7 files).

- [ ] **Step 5: Typecheck the whole package**

Run: `npm run typecheck`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add shared/src/balance.ts shared/src/balance.test.ts shared/src/index.ts
git commit -m "feat(shared): per-employee balance computation"
```

---

## Done criteria

- `npm test` → all suites pass (types, time, overlap, swap, swap-validate, balance, smoke).
- `npm run typecheck` → clean.
- The `@planer/shared` package exports every domain function later plans depend on.

## Next plan

Plan 2 — **Server**: Drizzle schema + SQLite, seed for shift presets (with Friday overrides), Hono API, Telegram `initData → JWT` auth, grammY bot skeleton + worker linking, and the transactional swap endpoint that wires `validateSwap` / `nextSwapStatus` to the database.
