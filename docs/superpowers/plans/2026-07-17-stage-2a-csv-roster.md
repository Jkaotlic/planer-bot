# Этап 2A: импорт/выгрузка ростера + заливка июня — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bidirectional CSV roster codec on the server (parse → decode → reconcile people → apply in one transaction; and export DB → matrix), fully unit-tested, plus a one-time guided load of June 2026 into the live database — so the bot holds all 26 people and the whole month, and the round-trip (import → export) reproduces the source file.

**Architecture:** All CSV logic lives on the server (§8.7: "сложность держим на сервере", frontends are untyped). Two new modules: `server/src/roster/roster-codec.ts` (PURE — parse/decode/encode, no DB) and `server/src/roster/roster-service.ts` (DB-facing — apply import in a transaction, build export). Decode looks presets up **by name** (name→id is identical on the live and fresh databases after migration 0006). Person reconciliation is a **human step** — the CSV carries surname-first ФИО that don't textually match the five nickname bot users, so a person map is supplied to `applyRosterImport`, which **renames existing rows** (preserving the Telegram link) and **creates** the rest, never inserting over a match. The one-time June load (Task 8) drives the tested service from a script with a human-confirmed map; no import screen is built (import is a one-off — future months are planned, not imported). Export is a guarded route + an admin button, mirroring the existing `payroll.csv` transport.

**Tech Stack:** TypeScript, Hono, Drizzle ORM + better-sqlite3, Vitest, zod. React (admin console) for the one export button.

**Spec:** [2026-07-15-duty-roles-coverage-import-design.md](../specs/2026-07-15-duty-roles-coverage-import-design.md) — Stage 2 is §6 «Этап 2»; the decode table is §8.1, import mechanics §8.6, risks §8.7, done-criteria §8.8.

## Global Constraints

- **Server-first.** Every parse/decode/reconcile/apply/export rule is server code under Vitest. The frontend gets exactly one addition: an "Экспорт ростера" button. Nothing else touches admin/ or miniapp/.
- **Validate every imported row through `createEntrySchema`** (`server/src/http/entry-schema.ts:37`, the `.superRefine` one) — NOT `updateEntrySchema` (`.partial()` drops the refine), NOT the stale `shiftSchema` in `shared/src/types.ts`. `createShift` (`repo/shifts.ts:5`) does no validation of its own.
- **Reconcile renames, never inserts over a match.** `employees.displayName` has **no unique index** (`schema.ts:12`) — a name-based insert would silently duplicate. The five nickname users are renamed by **id** via `renameEmployee` (`repo/employees.ts:80`), keeping `telegramUserId`. Importing them by name would create ghosts with null `telegramUserId`, and `reminder-service.ts:25` skips those **silently** — the bot would go mute for Панов, who holds the phone.
- **CSV format is fixed:** delimiter `;`, UTF-8 **with BOM**, **CRLF** line ends. Row 1 = `;` then dates `дд.мм.гггг`; column 1 = ФИО. Export must emit exactly this (BOM added by the route, like `payroll.csv`).
- **Friday times come from `resolveShiftTimes(preset, date)`** (`shared/src/time.ts:34`), never raw preset times. `k32`/`k32-7`/`k32-8` shorten by 1:15 on Friday; `k32-11`/`k32-15` (Вечер/Ночь) start **later** and do **not** shorten — this is already encoded in the preset rows' `fridayStart`/`fridayEnd`.
- **`holiday` is the non-working token, not a blank.** No shift row is written for it; the day is **proposed** as a `calendar_days` holiday but never auto-written. `Нет` and any undecodable code are reported with `{name,date,code}` and **not** recorded (§5, §7).
- **`otp`/`event` are ranges.** Consecutive same-code cells per person collapse into one row with `date`+`endDate`; the exporter expands them back. In this file vacation runs are **contiguous** (an отпускник's weekend cells are `otp`, not `holiday`), so no holiday-bridging is needed.
- **Preset ids are stable by name.** Migration 0006 gives `1=Утро, 2=День, 3=Вечер, 4=Ночь, 5=Дежурство · Поклонка, 6=Открытие, 7=Дежурство · Телефон, 8=Дежурство · Вавилова 19` on **both** the live and a fresh database. Decode/encode key on the preset **name**, never a hard-coded id.
- **Never `cp` the live database.** Back up with `sqlite3 data/planer.db ".backup <path>"` (the live file is ~4KB with a ~750KB WAL; a copy opens empty).
- **Restarting the live server is now `sudo launchctl kickstart -k system/com.planerbot.server`** — the bot runs as a launchd daemon (installed 2026-07-17). It guarantees a single instance, so two long-polls can't fight over the one `BOT_TOKEN`. Do **not** hand-launch the old `nohup` command while the daemon is up.
- **Baseline:** `npx vitest run` is green at **222 tests** and `npm run typecheck` is clean before this plan. Both must stay green after every task.

---

### Task 1: A typecheck gate for both frontends

Neither `admin/` nor `miniapp/` is typechecked today: `build` is a bare `vite build` (esbuild strips types), and the root `typecheck` script covers only `shared/` + `server/`. §8.8 lists `npm run typecheck` green in the done-criteria, and every later frontend edit (the export button here, the whole «Команда» view in 2B) would ship type errors silently. This lands **first** so the rest of the stage is protected. It is safe now — `tsc -p admin/tsconfig.json` and `tsc -p miniapp/tsconfig.json` both exit 0 on the current tree.

**Files:**
- Modify: `admin/package.json:8` (the `build` script) and add a `typecheck` script
- Modify: `miniapp/package.json:8` (the `build` script) and add a `typecheck` script
- Modify: `package.json:10` (root `typecheck` script)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run typecheck` now compiles all four packages; `npm run build -w @planer/admin` / `-w @planer/miniapp` fail on a type error.

- [ ] **Step 1: Prove both frontends are clean today**

Run:
```bash
cd /Users/user/planer-bot && npx tsc -p admin/tsconfig.json && npx tsc -p miniapp/tsconfig.json && echo "BOTH CLEAN"
```
Expected: no output from either `tsc`, then `BOTH CLEAN`. (`tsconfig.base.json` sets `noEmit: true`, inherited by every package, so this type-checks without emitting.) If either errors, STOP — fix the pre-existing error in its own commit before wiring the gate, or the gate lands red.

- [ ] **Step 2: Add the gate to the admin build**

`admin/package.json` — replace the `scripts` block (lines 6-10) with:

```json
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc -p tsconfig.json",
    "build": "tsc -p tsconfig.json && vite build",
    "preview": "vite preview"
  },
```

npm runs the script with cwd = `admin/`, so `tsconfig.json` resolves to `admin/tsconfig.json`.

- [ ] **Step 3: Add the identical gate to the mini app build**

`miniapp/package.json` — replace the `scripts` block (lines 6-10) with:

```json
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc -p tsconfig.json",
    "build": "tsc -p tsconfig.json && vite build",
    "preview": "vite preview"
  },
```

- [ ] **Step 4: Extend the root typecheck to all four packages**

`package.json:10` — replace the `typecheck` line with:

```json
    "typecheck": "tsc -p shared/tsconfig.json && tsc -p server/tsconfig.json && tsc -p admin/tsconfig.json && tsc -p miniapp/tsconfig.json"
```

- [ ] **Step 5: Verify the whole gate**

Run:
```bash
cd /Users/user/planer-bot && npm run typecheck && npm run build -w @planer/admin && npm run build -w @planer/miniapp
```
Expected: typecheck clean across four packages; both builds succeed (tsc then vite). This is the first time a frontend type error could break a build — that is the point.

- [ ] **Step 6: Commit**

```bash
git add package.json admin/package.json miniapp/package.json
git commit -m "build: typecheck admin and miniapp (both were shipping unchecked)

vite build strips types via esbuild and the root typecheck skipped both
frontends, so a type error in either shipped silently — worst on the mini
app's hand-mirrored types. Both tsc clean today, so the gate lands green."
```

---

### Task 2: One shared guard for every admin route

Every admin route repeats `requireAdmin(config.jwtSecret)` by hand (19 of them). There is no `app.use("/api/admin/*", …)`, so a new admin route that forgets the guard is a public write path (§8.7). A blanket guard makes `/api/admin/*` admin-only by construction; the existing inline guards stay (harmless double-check) so this task changes no behaviour and needs no edits to the 19 routes.

**Files:**
- Modify: `server/src/http/app.ts` (add one `app.use` after the `no-store` middleware, ~line 69)
- Test: `server/src/http/admin-guard.test.ts` (create)

**Interfaces:**
- Consumes: `requireAdmin` (already imported at `app.ts:8`).
- Produces: any `/api/admin/*` route is admin-only even without an inline guard. Task 6's export route relies on this.

- [ ] **Step 1: Write the failing test**

Create `server/src/http/admin-guard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { signInitData } from "../auth/telegram";
import type { Config } from "../config";

const config: Config = {
  botToken: "12345:tok", adminTelegramIds: [111], teamTz: "Europe/Moscow",
  databaseUrl: ":memory:", jwtSecret: "test-secret-16chars-min", publicUrl: "https://x.keenetic.pro",
};
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;

describe("blanket /api/admin/* guard", () => {
  it("blocks a made-up admin path for a non-admin, even with no inline guard", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-333" });
    linkTelegramAccount(db, "inv-333", 333);
    const app = createApp({ db, config });
    // A path under /api/admin/ that has no handler: the guard must still 403 (not 404) for a worker.
    const res = await app.request("/api/admin/does-not-exist", { headers: { Authorization: `Bearer ${await tokenFor(app, 333)}` } });
    expect(res.status).toBe(403);
  });

  it("lets an admin through to a real admin route", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const res = await app.request("/api/admin/employees", { headers: { Authorization: `Bearer ${await tokenFor(app, 111)}` } });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/http/admin-guard.test.ts`
Expected: the first test FAILS — with no blanket guard, `/api/admin/does-not-exist` falls through to a 404, not a 403.

- [ ] **Step 3: Add the blanket guard**

`server/src/http/app.ts` — immediately after the `no-store` middleware block that ends at line 69, before `app.onError` (line 71), insert:

```ts
  // Defence in depth: everything under /api/admin/* is admin-only by construction,
  // so a route that forgets its inline requireAdmin still can't leak. The per-route
  // guards below stay as belt-and-suspenders.
  app.use("/api/admin/*", requireAdmin(config.jwtSecret));
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run server/src/http/admin-guard.test.ts`
Expected: PASS — worker 403s on the unknown admin path, admin 200s on `/api/admin/employees`.

- [ ] **Step 5: Full suite + typecheck (nothing else moved)**

Run: `npx vitest run && npm run typecheck`
Expected: 223 tests (222 + admin-guard's 2, minus none), all pass; typecheck clean. If any existing admin-route test regressed, the double-guard changed behaviour — investigate before continuing (it should not: all `/api/admin/*` routes are already admin-only).

- [ ] **Step 6: Commit**

```bash
git add server/src/http/app.ts server/src/http/admin-guard.test.ts
git commit -m "feat(server): blanket requireAdmin on /api/admin/* (defence in depth)

19 admin routes each repeat requireAdmin by hand; a new one that forgets it
is a public write path. The blanket guard closes that by construction; the
inline guards stay. No behaviour change — every /api/admin/* route is already
admin-only."
```

---

### Task 3: Parse the roster CSV (pure)

The first half of the codec: bytes → structured `{dates, people}`. Pure string work, no DB, no decode yet. Tested against the real file so the BOM/CRLF/`;`/`дд.мм.гггг` handling is proven on real bytes.

**Files:**
- Create: `server/src/roster/roster-codec.ts`
- Test: `server/src/roster/roster-codec.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type RosterCell = { date: string; code: string }`
  - `type ParsedRoster = { dates: string[]; people: { name: string; cells: RosterCell[] }[] }`
  - `parseRosterCsv(text: string): ParsedRoster` — strips BOM, splits CRLF/LF, `;`; header col 0 is the empty name column, cols 1.. are `дд.мм.гггг` → `YYYY-MM-DD`.

- [ ] **Step 1: Write the failing test**

Create `server/src/roster/roster-codec.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseRosterCsv } from "./roster-codec";

const FILE = "/Users/user/Downloads/Дежурства 2026.csv";

describe("parseRosterCsv", () => {
  it("reads the real June file: 30 dates, 26 people, BOM stripped", () => {
    const parsed = parseRosterCsv(readFileSync(FILE, "utf8"));
    expect(parsed.dates).toHaveLength(30);
    expect(parsed.dates[0]).toBe("2026-06-01");
    expect(parsed.dates[29]).toBe("2026-06-30");
    expect(parsed.people).toHaveLength(26);
    // BOM must be gone — the first name is clean, not "﻿Юдин…".
    expect(parsed.people[0].name).toBe("Юдин Максим");
    expect(parsed.people[1].name).toBe("Панов Евгений");
    expect(parsed.people[0].cells[0]).toEqual({ date: "2026-06-01", code: "otp" });
    expect(parsed.people[1].cells[0]).toEqual({ date: "2026-06-01", code: "dezh" });
  });

  it("handles CRLF, LF and a trailing newline the same", () => {
    const text = "﻿;01.06.2026;02.06.2026\r\nИван;k32;holiday\r\n";
    const parsed = parseRosterCsv(text);
    expect(parsed.dates).toEqual(["2026-06-01", "2026-06-02"]);
    expect(parsed.people).toEqual([{ name: "Иван", cells: [
      { date: "2026-06-01", code: "k32" }, { date: "2026-06-02", code: "holiday" },
    ] }]);
  });

  it("rejects a malformed header date", () => {
    expect(() => parseRosterCsv(";2026-06-01\nИван;k32")).toThrow(/дата/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/roster/roster-codec.test.ts`
Expected: FAIL — `parseRosterCsv` is not defined.

- [ ] **Step 3: Implement the parser**

Create `server/src/roster/roster-codec.ts`:

```ts
export type RosterCell = { date: string; code: string };
export type ParsedRoster = { dates: string[]; people: { name: string; cells: RosterCell[] }[] };

/** "дд.мм.гггг" -> "YYYY-MM-DD". Throws on anything else. */
function parseRuDate(s: string): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim());
  if (!m) throw new Error(`плохая дата в шапке ростера: "${s}"`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function parseRosterCsv(text: string): ParsedRoster {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("пустой файл ростера");
  const header = lines[0].split(";");
  const dates = header.slice(1).map(parseRuDate); // header[0] is the empty name column
  const people = lines.slice(1).map((line) => {
    const fields = line.split(";");
    return {
      name: fields[0].trim(),
      cells: dates.map((date, i) => ({ date, code: (fields[i + 1] ?? "").trim() })),
    };
  });
  return { dates, people };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run server/src/roster/roster-codec.test.ts`
Expected: PASS — all three.

- [ ] **Step 5: Commit**

```bash
git add server/src/roster/roster-codec.ts server/src/roster/roster-codec.test.ts
git commit -m "feat(roster): parse the roster CSV (BOM, CRLF, ; delimiter, ru dates)"
```

---

### Task 4: Decode cells into entries — presets, Friday times, ranges, holidays, unknowns

The decode half of the codec. Turns each cell into a schedule entry via the §8.1 table: work codes resolve to a preset (by name) with Friday-aware times; `otp`/`event` collapse into date ranges; `holiday`/blank produce nothing; anything else is reported with coordinates. It also proposes holiday days (dates where nobody works). Tested against the real file with the exact numbers from the spec.

**Files:**
- Modify: `server/src/roster/roster-codec.ts`
- Test: `server/src/roster/roster-codec.test.ts` (append), and it needs the real 8 presets — pulled from `makeTestDb()`.

**Interfaces:**
- Consumes: `ParsedRoster` (Task 3); `resolveShiftTimes` from `@planer/shared`; `ShiftTemplate` type + `EntryCategory` from the DB/shared.
- Produces:
  - `type DecodedEntry = { date: string; endDate: string | null; category: EntryCategory; templateId: number | null; location: string | null; start: string | null; end: string | null; title: string | null }`
  - `type UnknownCell = { name: string; date: string; code: string }`
  - `type DecodeResult = { perPerson: { name: string; entries: DecodedEntry[] }[]; unknowns: UnknownCell[]; proposedHolidays: string[] }`
  - `CODE_TO_PRESET_NAME`, `CODE_TO_ABSENCE`, `PRESET_NAME_TO_CODE`, `ABSENCE_CATEGORY_TO_CODE`, `NON_WORKING_CODE` (exported — Task 6 reuses them for encode).
  - `decodeRoster(parsed: ParsedRoster, templates: ShiftTemplate[]): DecodeResult`

- [ ] **Step 1: Write the failing test**

Append to `server/src/roster/roster-codec.test.ts`:

```ts
import { makeTestDb } from "../db/testdb";
import { listActiveTemplates } from "../repo/templates";
import { decodeRoster } from "./roster-codec";

describe("decodeRoster (against the real June file + real presets)", () => {
  const templates = listActiveTemplates(makeTestDb()); // migration 0006 seeds all 8
  const decoded = decodeRoster(parseRosterCsv(readFileSync(FILE, "utf8")), templates);
  const person = (name: string) => decoded.perPerson.find((p) => p.name === name)!;

  it("collapses vacation and business-trip runs into 14 ranged rows total", () => {
    const absences = decoded.perPerson.flatMap((p) => p.entries.filter((e) => e.start === null));
    expect(absences).toHaveLength(14); // spec §5: 99 cells -> 14 rows

    const yudin = person("Юдин Максим").entries.find((e) => e.category === "vacation")!;
    expect(yudin).toMatchObject({ date: "2026-06-01", endDate: "2026-06-14", start: null, end: null, templateId: null });

    const nosov = person("Носов Максим").entries.find((e) => e.category === "business_trip")!;
    expect(nosov).toMatchObject({ date: "2026-06-01", endDate: "2026-06-07" });
  });

  it("shortens День on Friday but starts Вечер later without shortening", () => {
    // 2026-06-05 is a Friday (weekend cells 06/07.06 are Sat/Sun).
    const dyakovFri = person("Дьяков Алексей").entries.find((e) => e.date === "2026-06-05")!;
    expect(dyakovFri).toMatchObject({ category: "shift", title: "День", start: "09:00", end: "16:45" });
    const lapinFri = person("Лапин Виктор").entries.find((e) => e.date === "2026-06-05")!;
    expect(lapinFri).toMatchObject({ category: "shift", title: "Вечер", start: "12:00", end: "20:00" });
  });

  it("maps duty codes to the right presets with their location", () => {
    const pokl = person("Мишин Илья").entries.find((e) => e.date === "2026-06-01")!;
    expect(pokl).toMatchObject({ category: "duty", title: "Дежурство · Поклонка", location: "Поклонка", start: "09:00", end: "18:00" });
    const phone = person("Панов Евгений").entries.find((e) => e.date === "2026-06-01")!;
    expect(phone).toMatchObject({ category: "duty", title: "Дежурство · Телефон", start: "09:00", end: "18:00" });
  });

  it("reports the single undecodable cell and records nothing for it", () => {
    expect(decoded.unknowns).toEqual([{ name: "Хохлов Дмитрий", date: "2026-06-03", code: "Нет" }]);
    expect(person("Хохлов Дмитрий").entries.some((e) => e.date === "2026-06-03")).toBe(false);
  });

  it("proposes exactly the 9 non-working days, incl. the 12 June holiday", () => {
    expect(decoded.proposedHolidays).toHaveLength(9);
    expect(decoded.proposedHolidays).toContain("2026-06-12");
    expect(decoded.proposedHolidays).toContain("2026-06-06"); // a Saturday
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/roster/roster-codec.test.ts`
Expected: FAIL — `decodeRoster` is not defined.

- [ ] **Step 3: Implement the decode maps and function**

Append to `server/src/roster/roster-codec.ts`:

```ts
import { resolveShiftTimes, type EntryCategory } from "@planer/shared";
import type { ShiftTemplate } from "../db/schema";

export const NON_WORKING_CODE = "holiday";

/** Work code -> preset NAME (ids are stable by name across live/fresh DBs). */
export const CODE_TO_PRESET_NAME: Record<string, string> = {
  "k32": "День",
  "k32-7": "Открытие",
  "k32-8": "Утро",
  "k32-11": "Вечер",
  "k32-15": "Ночь",
  "dezh": "Дежурство · Телефон",
  "pokl": "Дежурство · Поклонка",
  "v19": "Дежурство · Вавилова 19",
};
/** Absence code -> category (stored as a date range, no times). */
export const CODE_TO_ABSENCE: Record<string, EntryCategory> = {
  "otp": "vacation",
  "event": "business_trip",
};
export const PRESET_NAME_TO_CODE: Record<string, string> =
  Object.fromEntries(Object.entries(CODE_TO_PRESET_NAME).map(([code, name]) => [name, code]));
export const ABSENCE_CATEGORY_TO_CODE: Partial<Record<EntryCategory, string>> =
  Object.fromEntries(Object.entries(CODE_TO_ABSENCE).map(([code, cat]) => [cat, code]));

export type DecodedEntry = {
  date: string;
  endDate: string | null;
  category: EntryCategory;
  templateId: number | null;
  location: string | null;
  start: string | null;
  end: string | null;
  title: string | null;
};
export type UnknownCell = { name: string; date: string; code: string };
export type DecodeResult = {
  perPerson: { name: string; entries: DecodedEntry[] }[];
  unknowns: UnknownCell[];
  proposedHolidays: string[];
};

export function decodeRoster(parsed: ParsedRoster, templates: ShiftTemplate[]): DecodeResult {
  const byName = new Map(templates.map((t) => [t.name, t] as const));
  const unknowns: UnknownCell[] = [];
  const workersByDate = new Map<string, number>(); // count of WORK-code cells per date

  const perPerson = parsed.people.map((p) => {
    const entries: DecodedEntry[] = [];
    let run: { category: EntryCategory; code: string; from: string; to: string } | null = null;
    const flush = () => {
      if (!run) return;
      entries.push({
        date: run.from, endDate: run.to === run.from ? null : run.to,
        category: run.category, templateId: null, location: null, start: null, end: null, title: null,
      });
      run = null;
    };

    for (const cell of p.cells) {
      const code = cell.code;
      if (code === NON_WORKING_CODE || code === "") { flush(); continue; }

      const absence = CODE_TO_ABSENCE[code];
      if (absence) {
        if (run && run.code === code) run.to = cell.date;
        else { flush(); run = { category: absence, code, from: cell.date, to: cell.date }; }
        continue;
      }

      flush();
      const preset = byName.get(CODE_TO_PRESET_NAME[code] ?? "");
      if (!preset) { unknowns.push({ name: p.name, date: cell.date, code }); continue; }
      const { start, end } = resolveShiftTimes(preset, cell.date);
      entries.push({
        date: cell.date, endDate: null, category: preset.category, templateId: preset.id,
        location: preset.location, start, end, title: preset.name,
      });
      workersByDate.set(cell.date, (workersByDate.get(cell.date) ?? 0) + 1);
    }
    flush();
    return { name: p.name, entries };
  });

  // A day is non-working iff nobody has a work code on it (§5). Absences don't count as work.
  const proposedHolidays = parsed.dates.filter((d) => (workersByDate.get(d) ?? 0) === 0);
  return { perPerson, unknowns, proposedHolidays };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run server/src/roster/roster-codec.test.ts`
Expected: PASS — all decode tests, including the 14-range and 9-holiday counts.

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all pass; typecheck clean. (`resolveShiftTimes` accepts a DB `ShiftTemplate` — it only reads `start/end/fridayStart/fridayEnd`, all present.)

- [ ] **Step 6: Commit**

```bash
git add server/src/roster/roster-codec.ts server/src/roster/roster-codec.test.ts
git commit -m "feat(roster): decode cells to entries — presets, Friday times, ranges, holidays

Work codes resolve to a preset by name with resolveShiftTimes (Вечер/Ночь start
later on Friday, don't shorten); otp/event collapse into date ranges; holiday/blank
write nothing; unknown codes are reported with coordinates. Verified against the
real June file: 14 absence ranges, 9 proposed holidays, the one 'Нет' reported."
```

---

### Task 5: Apply an import — reconcile people, insert in one transaction, audit

The DB-writing core. Given the decode result and a human-supplied person map, resolve each CSV name to an `employeeId` (rename an existing row keeping its Telegram link, or create a new one), validate every entry through `createEntrySchema`, insert them all in **one transaction**, and write one audit row so the import shows in `GET /api/admin/events`.

**Files:**
- Create: `server/src/roster/roster-service.ts`
- Test: `server/src/roster/roster-service.test.ts`

**Interfaces:**
- Consumes: `DecodeResult` (Task 4); `createEntrySchema` (`http/entry-schema.ts`); the `employees`/`shifts`/`auditLog` tables (`db/schema.ts`); `Db` (`db/client.ts`).
- Produces:
  - `type PersonResolution = { csvName: string; action: "rename"; employeeId: number } | { csvName: string; action: "create" }`
  - `type ImportSummary = { employeesRenamed: number; employeesCreated: number; entriesInserted: number; unknowns: UnknownCell[] }`
  - `applyRosterImport(db: Db, decoded: DecodeResult, resolutions: PersonResolution[], actorEmployeeId: number | null): ImportSummary`
  - Task 8 calls this against the live DB.

- [ ] **Step 1: Write the failing test**

Create `server/src/roster/roster-service.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getEmployeeById, listActive } from "../repo/employees";
import { listShiftsInRange } from "../repo/shifts";
import { listRecentAudit } from "../repo/audit";
import { applyRosterImport, type PersonResolution } from "./roster-service";
import type { DecodeResult } from "./roster-codec";

function decode(perPerson: DecodeResult["perPerson"]): DecodeResult {
  return { perPerson, unknowns: [], proposedHolidays: [] };
}

describe("applyRosterImport", () => {
  it("renames an existing nickname user (keeping Telegram) and creates the rest", () => {
    const db = makeTestDb();
    const bot = createEmployee(db, { displayName: "Женя Тест", inviteToken: "inv-1" });
    linkTelegramAccount(db, "inv-1", 555, "demo_worker3");

    const decoded = decode([
      { name: "Панов Евгений", entries: [{ date: "2026-06-01", endDate: null, category: "duty", templateId: 7, location: null, start: "09:00", end: "18:00", title: "Дежурство · Телефон" }] },
      { name: "Новиков Пётр", entries: [{ date: "2026-06-01", endDate: null, category: "shift", templateId: 2, location: null, start: "09:00", end: "18:00", title: "День" }] },
    ]);
    const resolutions: PersonResolution[] = [
      { csvName: "Панов Евгений", action: "rename", employeeId: bot.id },
      { csvName: "Новиков Пётр", action: "create" },
    ];

    const summary = applyRosterImport(db, decoded, resolutions, null); // actor null — audit.actorEmployeeId is a nullable FK; a bogus id would trip foreign_keys=ON
    expect(summary).toMatchObject({ employeesRenamed: 1, employeesCreated: 1, entriesInserted: 2 });

    const renamed = getEmployeeById(db, bot.id)!;
    expect(renamed.displayName).toBe("Панов Евгений");
    expect(renamed.telegramUserId).toBe(555); // link preserved — the whole point

    expect(listActive(db).map((e) => e.displayName).sort()).toEqual(["Панов Евгений", "Новиков Пётр"]);
    expect(listShiftsInRange(db, "2026-06-01", "2026-06-01")).toHaveLength(2);
    expect(listRecentAudit(db, 10).filter((a) => a.type === "roster_import")).toHaveLength(1);
  });

  it("is atomic: a row that fails createEntrySchema rolls the whole import back", () => {
    const db = makeTestDb();
    const before = listActive(db).length;
    const decoded = decode([
      // start present but end missing -> countsForBalance('shift') requires both -> createEntrySchema rejects.
      { name: "Плохой Ряд", entries: [{ date: "2026-06-01", endDate: null, category: "shift", templateId: 2, location: null, start: "09:00", end: null, title: "День" }] },
    ]);
    expect(() => applyRosterImport(db, decoded, [{ csvName: "Плохой Ряд", action: "create" }], null)).toThrow(/2026-06-01/);
    expect(listActive(db).length).toBe(before);       // no employee created
    expect(listShiftsInRange(db, "2026-06-01", "2026-06-01")).toHaveLength(0); // no shift inserted
  });

  it("throws if a decoded person has no resolution", () => {
    const db = makeTestDb();
    const decoded = decode([{ name: "Без Карты", entries: [] }]);
    expect(() => applyRosterImport(db, decoded, [], null)).toThrow(/Без Карты/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/roster/roster-service.test.ts`
Expected: FAIL — `applyRosterImport` is not defined.

- [ ] **Step 3: Implement the service**

Create `server/src/roster/roster-service.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { employees, shifts, auditLog } from "../db/schema";
import { createEntrySchema } from "../http/entry-schema";
import type { DecodeResult, UnknownCell } from "./roster-codec";

export type PersonResolution =
  | { csvName: string; action: "rename"; employeeId: number }
  | { csvName: string; action: "create" };

export type ImportSummary = {
  employeesRenamed: number;
  employeesCreated: number;
  entriesInserted: number;
  unknowns: UnknownCell[];
};

export function applyRosterImport(
  db: Db,
  decoded: DecodeResult,
  resolutions: PersonResolution[],
  actorEmployeeId: number | null,
): ImportSummary {
  const byName = new Map(resolutions.map((r) => [r.csvName, r] as const));
  for (const p of decoded.perPerson) {
    if (!byName.has(p.name)) throw new Error(`нет сверки для «${p.name}»`);
  }

  return db.transaction((tx) => {
    let renamed = 0, created = 0, inserted = 0;
    for (const person of decoded.perPerson) {
      const res = byName.get(person.name)!;
      let employeeId: number;
      if (res.action === "rename") {
        // Rename in place — keeps telegramUserId, so reminders keep reaching them.
        tx.update(employees).set({ displayName: person.name }).where(eq(employees.id, res.employeeId)).run();
        employeeId = res.employeeId;
        renamed++;
      } else {
        employeeId = tx.insert(employees).values({ displayName: person.name }).returning().all()[0]!.id;
        created++;
      }
      for (const e of person.entries) {
        const parsed = createEntrySchema.safeParse({
          date: e.date, endDate: e.endDate, category: e.category, templateId: e.templateId,
          location: e.location, start: e.start, end: e.end, title: e.title, employeeId,
        });
        if (!parsed.success) {
          const msg = parsed.error.issues.map((i) => i.message).join("; ");
          throw new Error(`строка ${person.name}/${e.date} не прошла проверку: ${msg}`);
        }
        tx.insert(shifts).values(parsed.data).run();
        inserted++;
      }
    }
    tx.insert(auditLog).values({
      type: "roster_import",
      actorEmployeeId,
      payload: { employeesRenamed: renamed, employeesCreated: created, entriesInserted: inserted, unknowns: decoded.unknowns.length },
    }).run();
    return { employeesRenamed: renamed, employeesCreated: created, entriesInserted: inserted, unknowns: decoded.unknowns };
  });
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run server/src/roster/roster-service.test.ts`
Expected: PASS — rename keeps `telegramUserId=555`; the bad-row case leaves the DB untouched (transaction rollback); the missing-resolution case throws.

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all pass; typecheck clean. (`createEntrySchema.safeParse` output feeds `tx.insert(shifts).values(...)`; the parsed shape matches `NewShift` exactly as `POST /api/admin/entries` already relies on.)

- [ ] **Step 6: Commit**

```bash
git add server/src/roster/roster-service.ts server/src/roster/roster-service.test.ts
git commit -m "feat(roster): apply an import — reconcile, validate, insert atomically, audit

Renames the five nickname users by id (keeping their Telegram link, so reminders
don't go mute) and creates the rest; every row passes createEntrySchema; the whole
import is one transaction so a bad row rolls it all back; one audit row lands in
GET /api/admin/events."
```

---

### Task 6: Export the roster — DB → the same matrix, and a download route

The reverse half. Rebuild the `дд.мм.гггг × ФИО` matrix from the DB: one row per active worker, each date's cell encoded back to its code (preset→code, absence category→code with ranges expanded, non-working→`holiday`). Exposed as a guarded CSV route mirroring `payroll.csv`. The headline test is the round-trip: import the real June file, export it, get the source back.

**Files:**
- Modify: `server/src/roster/roster-codec.ts` (add `serializeRosterCsv` + `datesInRange` + `encodeEntryCode`)
- Modify: `server/src/repo/shifts.ts` (add `listShiftsOverlapping`)
- Modify: `server/src/roster/roster-service.ts` (add `buildRosterCsv`)
- Modify: `server/src/http/app.ts` (add `GET /api/admin/roster.csv`)
- Test: `server/src/roster/roster-service.test.ts` (append the round-trip)

**Interfaces:**
- Consumes: `PRESET_NAME_TO_CODE`, `ABSENCE_CATEGORY_TO_CODE`, `NON_WORKING_CODE` (Task 4); `listActive`, `listActiveTemplates`; `applyRosterImport` (Task 5).
- Produces:
  - `datesInRange(from, to): string[]`, `serializeRosterCsv(dates, rows): string`, `encodeEntryCode(shift, templatesById): string` (in the codec).
  - `listShiftsOverlapping(db, from, to): Shift[]` (spans that touch the window, not just start in it).
  - `buildRosterCsv(db, from, to): string` (no BOM — the route adds it).
  - `GET /api/admin/roster.csv?from&to` → BOM-prefixed `text/csv` download.

- [ ] **Step 1: Write the failing round-trip test**

Append to `server/src/roster/roster-service.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { listActiveTemplates } from "../repo/templates";
import { parseRosterCsv, decodeRoster } from "./roster-codec";
import { buildRosterCsv } from "./roster-service";

const FILE = "/Users/user/Downloads/Дежурства 2026.csv";

describe("roster round-trip", () => {
  it("import June then export gives back the source matrix (bar the one 'Нет' cell)", () => {
    const db = makeTestDb();
    const source = readFileSync(FILE, "utf8");
    const decoded = decodeRoster(parseRosterCsv(source), listActiveTemplates(db));
    // Reconcile everyone as 'create' (fresh DB has no employees yet).
    const resolutions = decoded.perPerson.map((p) => ({ csvName: p.name, action: "create" as const }));
    applyRosterImport(db, decoded, resolutions, null);

    const exported = "﻿" + buildRosterCsv(db, "2026-06-01", "2026-06-30");

    // The only expected difference: Хохлов/03.06 was 'Нет' (undecodable, not stored) -> exports as 'holiday'.
    const normalize = (s: string) =>
      s.replace(/\r\n/g, "\n").trim().replace("Хохлов Дмитрий;k32;k32;Нет;", "Хохлов Дмитрий;k32;k32;holiday;");
    expect(normalize(exported)).toBe(normalize(source));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/roster/roster-service.test.ts`
Expected: FAIL — `buildRosterCsv` is not defined.

- [ ] **Step 3: Add the encode + serialize helpers to the codec**

Append to `server/src/roster/roster-codec.ts`:

```ts
import { nextDate } from "@planer/shared";
import type { Shift } from "../db/schema";

export function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = nextDate(d)) out.push(d);
  return out;
}

/** "YYYY-MM-DD" -> "дд.мм.гггг" for the export header. */
function toRuDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function rosterField(v: string): string {
  return /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** One entry -> its roster code. Preset wins; else absence category; else non-working. */
export function encodeEntryCode(shift: Pick<Shift, "category" | "templateId">, templatesById: Map<number, { name: string }>): string {
  if (shift.templateId != null) {
    const name = templatesById.get(shift.templateId)?.name;
    const code = name ? PRESET_NAME_TO_CODE[name] : undefined;
    if (code) return code;
  }
  return ABSENCE_CATEGORY_TO_CODE[shift.category] ?? NON_WORKING_CODE;
}

export function serializeRosterCsv(dates: string[], rows: { name: string; codes: string[] }[]): string {
  const header = ["", ...dates.map(toRuDate)].join(";");
  const lines = rows.map((r) => [rosterField(r.name), ...r.codes].join(";"));
  return [header, ...lines].join("\r\n");
}
```

- [ ] **Step 4: Add the overlap query to the shifts repo**

`server/src/repo/shifts.ts` — add the import `sql` to the top `drizzle-orm` import (it becomes `import { and, eq, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";`), then append:

```ts
/** Shifts whose span [date, endDate ?? date] touches [from, to] — includes a
 *  multi-day absence that began before `from`, which listShiftsInRange misses. */
export function listShiftsOverlapping(db: Db, from: string, to: string): Shift[] {
  return db
    .select()
    .from(shifts)
    .where(and(lte(shifts.date, to), gte(sql`coalesce(${shifts.endDate}, ${shifts.date})`, from)))
    .orderBy(shifts.date, shifts.start)
    .all();
}
```

- [ ] **Step 5: Add `buildRosterCsv` to the service**

`server/src/roster/roster-service.ts` — add imports and the function:

```ts
import { listActive } from "../repo/employees";
import { listActiveTemplates } from "../repo/templates";
import { listShiftsOverlapping } from "../repo/shifts";
import { datesInRange, serializeRosterCsv, encodeEntryCode } from "./roster-codec";
```

```ts
/** Rebuild the roster matrix for [from, to]: one row per active worker, each cell
 *  the reverse of decode. No BOM — the download route adds it (like payroll.csv). */
export function buildRosterCsv(db: Db, from: string, to: string): string {
  const dates = datesInRange(from, to);
  const workers = listActive(db);
  const shifts = listShiftsOverlapping(db, from, to);
  const templatesById = new Map(listActiveTemplates(db).map((t) => [t.id, t] as const));
  const rows = workers.map((w) => ({
    name: w.displayName,
    codes: dates.map((date) => {
      const covering = shifts.find((s) => s.employeeId === w.id && s.date <= date && (s.endDate ?? s.date) >= date);
      return covering ? encodeEntryCode(covering, templatesById) : "holiday";
    }),
  }));
  return serializeRosterCsv(dates, rows);
}
```

- [ ] **Step 6: Run the round-trip test**

Run: `npx vitest run server/src/roster/roster-service.test.ts`
Expected: PASS. If it fails, `diff` the two strings — a mismatch is a decode/encode asymmetry (most likely a Friday time or a range boundary), not a plumbing bug.

- [ ] **Step 7: Add the download route**

`server/src/http/app.ts` — import `buildRosterCsv` at the top (add `import { buildRosterCsv } from "../roster/roster-service";`), then add this route next to the payroll CSV route (after line 474, still inside `createApp`):

```ts
  // Admin: the whole roster as the same дд.мм.гггг × ФИО matrix the import reads.
  app.get("/api/admin/roster.csv", requireAdmin(config.jwtSecret), (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) return c.json({ error: "from and to are required" }, 400);
    const csv = buildRosterCsv(db, from, to);
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="roster-${from}_${to}.csv"`);
    return c.body("﻿" + csv);
  });
```

- [ ] **Step 8: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add server/src/roster/roster-codec.ts server/src/roster/roster-service.ts server/src/repo/shifts.ts server/src/http/app.ts server/src/roster/roster-service.test.ts
git commit -m "feat(roster): export the roster matrix + GET /api/admin/roster.csv

Reverse of decode: preset->code, absence category->code (ranges expanded),
non-working->holiday, one row per active worker. Proven by a round-trip test —
import the real June file, export it, get the source back (bar the one 'Нет'
cell, which is undecodable and not stored). listShiftsOverlapping so a span that
began before the window still paints."
```

---

### Task 7: An "Экспорт ростера" button in the admin console

The only frontend in this stage. One button that fetches `/api/admin/roster.csv` for the current month and downloads it, reusing the exact Blob+anchor pattern the weekend payroll export already uses.

**Files:**
- Modify: `admin/src/api/client.ts` (add `getRosterCsv` to the `ApiClient` interface + both `realClient` and the dev `mock`/`devClient`)
- Modify: `admin/src/screens/WeekendAdminScreen.tsx` *(or the schedule screen — see Step 1)* to add the button
- (No test — frontends have none; the tsc gate from Task 1 is the guard.)

**Interfaces:**
- Consumes: `GET /api/admin/roster.csv` (Task 6).
- Produces: `apiClient.getRosterCsv(from, to): Promise<string>` and a working download button.

- [ ] **Step 1: Decide where the button lives**

Run: `grep -n "getPayrollCsv" admin/src/api/client.ts`
This shows the CSV client method to mirror and confirms the `realClient`/`devClient` split. Put the button on the **schedule** screen's top bar (`admin/src/App.tsx`, next to the week label) if a natural slot exists; otherwise add a small "Экспорт" control to `WeekendAdminScreen`'s header. Read the chosen file first and match its existing button classes (`btn btn-secondary`).

- [ ] **Step 2: Add `getRosterCsv` to the API client**

`admin/src/api/client.ts` — find the `ApiClient` interface and the `getPayrollCsv(from, to): Promise<string>` member; add directly below it:

```ts
  getRosterCsv(from: string, to: string): Promise<string>;
```

In `realClient`, mirror `getPayrollCsv`'s implementation (a raw `fetch` with the `Authorization` header returning `res.text()`), pointing at `/api/admin/roster.csv`:

```ts
  getRosterCsv: (from, to) => authedText(`/api/admin/roster.csv?from=${from}&to=${to}`),
```

(Use whatever helper `getPayrollCsv` uses — match it exactly; `authedText` is illustrative.) In the dev `mock`/`devClient`, add a stub so DEV mode and the tsc gate stay green:

```ts
  getRosterCsv: async () => ";01.06.2026\nМок Пользователь;k32",
```

- [ ] **Step 3: Add the button**

In the chosen screen, add a control that calls `getRosterCsv` for the current month and downloads it — copy `WeekendAdminScreen.tsx`'s `exportCsv` (lines 223-240) verbatim, swapping the client call and filename:

```tsx
async function exportRoster() {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
  const csv = await apiClient.getRosterCsv(from, to);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `roster-${from}_${to}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

```tsx
<button type="button" className="btn btn-secondary" onClick={() => void exportRoster()}>
  ⬇ Экспорт ростера
</button>
```

- [ ] **Step 4: Typecheck + build the admin app**

Run: `npm run build -w @planer/admin`
Expected: `tsc` clean (Task 1's gate) then `vite build` succeeds.

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all pass; typecheck clean across four packages.

- [ ] **Step 6: Commit**

```bash
git add admin/src/api/client.ts admin/src/screens/WeekendAdminScreen.tsx admin/src/App.tsx
git commit -m "feat(admin): «Экспорт ростера» button — downloads /api/admin/roster.csv

Reuses the weekend payroll Blob+anchor download (BOM for Excel/Cyrillic)."
```

---

### Task 8: Load June 2026 into the live database (guided, human-in-the-loop)

The payoff. Everything above is tested; this is the one-time run against production, with a person reconciliation the human must confirm. It reads, backs up, decodes, shows the map in plain Russian on real names, applies to the live DB, and proves the round-trip — then hands the restart back.

**Files:** none — this task reads, backs up, and runs the tested service.

**Interfaces:**
- Consumes: everything from Tasks 3-6.
- Produces: 26 people and all of June 2026 in the live DB; five nickname users renamed with their Telegram link intact; export round-trips.

- [ ] **Step 1: Back up the live database — `.backup`, never `cp`**

```bash
cd /Users/user/planer-bot
sqlite3 data/planer.db ".backup /Users/user/planer-pre-june-import.db"
sqlite3 /Users/user/planer-pre-june-import.db "SELECT COUNT(*) AS employees FROM employees; SELECT COUNT(*) AS shifts FROM shifts;"
```
Expected: the current employee count (≈6) and shift count. If either is `0` or "no such table", the WAL wasn't captured — STOP and redo the backup.

- [ ] **Step 2: Show the live people next to the CSV names (for the human map)**

Write `scripts/roster-reconcile.mts` in the repo root (it needs `node_modules`, which don't resolve from the scratchpad):

```ts
import { openDb } from "./server/src/db/client";
import { listActive } from "./server/src/repo/employees";
import { readFileSync } from "node:fs";
import { parseRosterCsv } from "./server/src/roster/roster-codec";

const { db } = openDb("./data/planer.db");
console.log("=== live employees (id · name · @username · tg linked?) ===");
for (const e of listActive(db)) {
  console.log(`${e.id}\t${e.displayName}\t@${e.tgUsername ?? "—"}\ttg:${e.telegramUserId ?? "нет"}`);
}
console.log("\n=== CSV names (file order) ===");
parseRosterCsv(readFileSync("/Users/user/Downloads/Дежурства 2026.csv", "utf8")).people.forEach((p, i) =>
  console.log(`${i + 1}\t${p.name}`));
```

Run: `./node_modules/.bin/tsx scripts/roster-reconcile.mts`

**Do not proceed automatically.** Present the two lists to the user in plain Russian and confirm, per spec §5, that:
- @demo_admin → **Орлов Андрей**, @titov → **Титов Михаил**, @demo_worker2 → **Гущин Кирилл**, @demo_worker3 → **Панов Евгений**, @demo_worker4 → **Сафонов Михаил** (five **renames**, by the live id shown);
- the `__TEST` user is **skipped** (not in the file);
- the other 21 CSV names are **created**.
Verify the usernames against the live output — the spec table is from memory; the live DB is the source of truth. Only once the user confirms the five ids, build the resolutions list.

- [ ] **Step 3: Apply the import to the live database**

Write `scripts/roster-import.mts` with the **confirmed** resolutions filled in (five `rename` with the live ids from Step 2, everyone else `create`):

```ts
import { openDb } from "./server/src/db/client";
import { readFileSync } from "node:fs";
import { parseRosterCsv, decodeRoster } from "./server/src/roster/roster-codec";
import { applyRosterImport, type PersonResolution } from "./server/src/roster/roster-service";
import { listActiveTemplates } from "./server/src/repo/templates";

const { db } = openDb("./data/planer.db");
const decoded = decodeRoster(parseRosterCsv(readFileSync("/Users/user/Downloads/Дежурства 2026.csv", "utf8")), listActiveTemplates(db));

// <<< Fill from the human-confirmed Step 2 output. Every CSV name needs a line. >>>
const renames: Record<string, number> = {
  "Орлов Андрей": 0, "Титов Михаил": 0, "Гущин Кирилл": 0, "Панов Евгений": 0, "Сафонов Михаил": 0,
};
const resolutions: PersonResolution[] = decoded.perPerson.map((p) =>
  p.name in renames ? { csvName: p.name, action: "rename", employeeId: renames[p.name] } : { csvName: p.name, action: "create" });

console.log("unknowns:", decoded.unknowns);
console.log("proposedHolidays:", decoded.proposedHolidays);
console.log("summary:", applyRosterImport(db, decoded, resolutions, null));
```

Run (only after the `renames` ids are filled): `./node_modules/.bin/tsx scripts/roster-import.mts`
Expected: `unknowns` = the single Хохлов/03.06 `Нет`; `proposedHolidays` = 9 dates; `summary` = `{ employeesRenamed: 5, employeesCreated: 21, entriesInserted: <count>, unknowns: 1 }`.

- [ ] **Step 4: Prove the load and the round-trip on the live DB**

```bash
sqlite3 data/planer.db "
  SELECT COUNT(*) AS employees FROM employees WHERE is_active = 1;
  SELECT telegram_user_id FROM employees WHERE display_name = 'Панов Евгений';
  PRAGMA foreign_key_check;
"
./node_modules/.bin/tsx -e '
  import { openDb } from "./server/src/db/client";
  import { buildRosterCsv } from "./server/src/roster/roster-service";
  import { readFileSync, writeFileSync } from "node:fs";
  const { db } = openDb("./data/planer.db");
  const exported = "﻿" + buildRosterCsv(db, "2026-06-01", "2026-06-30");
  writeFileSync("/tmp/roster-export.csv", exported);
  const src = readFileSync("/Users/user/Downloads/Дежурства 2026.csv","utf8").replace(/\r\n/g,"\n").trim().replace("Хохлов Дмитрий;k32;k32;Нет;","Хохлов Дмитрий;k32;k32;holiday;");
  console.log("round-trip:", exported.replace(/\r\n/g,"\n").trim() === src ? "IDENTICAL" : "DIFF — inspect /tmp/roster-export.csv");
'
```
Expected: 26 active employees; Панов's `telegram_user_id` is **non-null** (his rename kept the link); no FK violations; `round-trip: IDENTICAL`.

- [ ] **Step 5: Delete the one-off scripts and hand back the restart**

```bash
git rm -f scripts/roster-reconcile.mts scripts/roster-import.mts 2>/dev/null || rm -f scripts/roster-reconcile.mts scripts/roster-import.mts
```

The live DB now holds June, but the **running** daemon is serving the old in-memory state only for cached reads — migrations already ran, and the schedule reads are per-request, so a restart isn't strictly required to serve the new data. Restart anyway to be certain and to pick up the new server code (roster routes):

```bash
npm run build -w @planer/admin && npm run build -w @planer/miniapp   # mountSpa throws at boot if dist is stale
sudo launchctl kickstart -k system/com.planerbot.server               # single-instance restart (launchd)
curl -s -o /dev/null -w "health: %{http_code}\n" http://localhost:8090/
```
Expected: `health: 302`. Report to the user: 26 people + June in the live DB, Панов's reminders intact, round-trip identical, backup at `/Users/user/planer-pre-june-import.db`.

- [ ] **Step 6: Commit (docs/ledger only — no scripts)**

```bash
git add docs/ .superpowers/
git commit -m "chore(roster): June 2026 loaded into the live DB (guided one-off)

26 people, five nickname users renamed keeping their Telegram link, export
round-trips the source file. One-off scripts removed; logic lives in the tested
server/src/roster modules."
```

---

## Self-Review

**Spec coverage (§5, §6 «Этап 2», §8.1, §8.6, §8.7, §8.8):**
- Upload → understand → reconcile → apply flow → server codec (Tasks 3-5) driven by the guided load (Task 8); no import screen by design (option A).
- People reconciliation, rename-not-insert, Telegram link preserved → Task 5 (asserted) + Task 8 (live).
- Ranges collapse (99→14), Friday times, holiday proposal, unknown cells reported → Task 4 (asserted against the real file).
- Every row via `createEntrySchema`, one transaction, audit row → Task 5.
- Export = same matrix → Task 6 round-trip; "выгрузка кнопкой" → Task 7.
- Shared admin guard (§8.7) → Task 2. Body-size limit (§8.7) is **deferred** — see deviations.
- `npm run typecheck` green in done-criteria (§8.8) → Task 1 brings both frontends under it.

**Deviations from the spec, deliberate:**
- **No import HTTP route / no import screen.** Option A (confirmed with the user): June is the only import ever (future months are planned, not imported), and the frontend is untyped/untested. The tested service is driven once from a script (Task 8). The preview/apply *endpoints* the spec's §5 UI implies are **not built**; if a reusable import UI is ever wanted, `applyRosterImport` already exists and a `POST /api/admin/roster/import` is a thin wrapper behind the Task 2 guard.
- **Body-size limit (§8.7) deferred.** It guards the *import route*, which this stage doesn't add. When/if that route lands, cap the body there.
- **Holidays proposed, not written.** `decodeRoster` returns `proposedHolidays`; nothing writes `calendar_days` (it stays inert until Stage 3/4). Task 8 prints them for the record.

**Placeholder scan:** none. Task 7 marks two spots ("see Step 1", `authedText` "illustrative") that require reading the real `admin/src/api/client.ts` first — flagged explicitly with the grep to run, because the exact CSV-client helper name is the one thing the survey didn't pin. Every server step has complete code.

**Type consistency:** `DecodeResult`/`DecodedEntry`/`UnknownCell` (Task 4) are consumed unchanged by `applyRosterImport` (Task 5). `PRESET_NAME_TO_CODE`/`ABSENCE_CATEGORY_TO_CODE`/`NON_WORKING_CODE` (Task 4) → `encodeEntryCode` (Task 6). `PersonResolution` shape matches between Task 5's definition, its test, and Task 8's script. `createEntrySchema.safeParse(...).data` → `tx.insert(shifts).values(...)` relies on the same `CreateEntryInput`→`NewShift` compatibility that `POST /api/admin/entries` (`app.ts:212`) already uses.

**Known risk carried into 2B:** the mini app's «Команда» view is the next plan; Task 1's typecheck gate is what will keep its hand-mirrored types honest.
