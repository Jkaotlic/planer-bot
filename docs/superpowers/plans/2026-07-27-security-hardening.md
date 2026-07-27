# Production Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Telegram credentials from being written to logs, make shutdown failures non-fatal, revoke stale JWT privileges from live database state, and restrict runtime files to the service account.

**Architecture:** Authentication middleware will verify the JWT signature and then resolve the employee from SQLite on every request, using current `isActive` and `isAdmin` values as authority. Telegram error logging will pass through one redacting formatter and shutdown will use a caught async lifecycle helper. Runtime permissions are applied operationally after code verification.

**Tech Stack:** TypeScript, Hono, grammY, Drizzle ORM, better-sqlite3, Vitest, launchd.

## Global Constraints

- Do not rotate, print, replace, or otherwise expose the current Telegram bot token.
- Do not install backup automation, log rotation, CI, or Git remotes in this change.
- Write each behavior test first and observe the expected failure before production edits.
- Preserve all existing HTTP status behavior except immediate rejection of archived users and revoked admins.
- Do not restart launchd until tests, typecheck, and both frontend builds are green.

---

### Task 1: Live authorization state

**Files:**
- Modify: `server/src/http/middleware.ts`
- Modify: `server/src/http/app.ts`
- Test: `server/src/http/admin-guard.test.ts`

**Interfaces:**
- Consumes: `getEmployeeById(db, employeeId)` and verified `AuthClaims`.
- Produces: `requireAuth(db: Db, secret: string)` and `requireAdmin(db: Db, secret: string)`.

- [x] **Step 1: Add failing revoked-session tests**

Add tests proving:

```ts
it("rejects an already-issued admin JWT immediately after demotion", async () => {
  // issue the token while isAdmin=true, demote in DB, expect an admin route to return 403
});

it("rejects an already-issued JWT immediately after employee archival", async () => {
  // issue the token while active, archive in DB, expect /api/me to return 401
});
```

- [x] **Step 2: Run the focused tests and confirm RED**

Run: `npx vitest run server/src/http/admin-guard.test.ts`

Expected: the demoted token still returns 200 and the archived token still authenticates.

- [x] **Step 3: Make SQLite the current authorization authority**

Change middleware signatures to accept `Db`. After JWT verification, load the employee by `claims.employeeId`; reject missing/inactive employees. `requireAdmin` must additionally require the live row's `isAdmin`, and both middleware functions must store claims rebuilt with the current database role.

Update every `requireAuth` and `requireAdmin` call in `createApp` to pass `db`.

- [x] **Step 4: Run focused and full tests**

Run:

```bash
npx vitest run server/src/http/admin-guard.test.ts server/src/http/app.test.ts server/src/http/employees.test.ts
npm test
```

Expected: all pass.

### Task 2: Secret-safe Telegram errors and shutdown

**Files:**
- Create: `server/src/util/safe-error.ts`
- Create: `server/src/util/safe-error.test.ts`
- Create: `server/src/bot/lifecycle.ts`
- Create: `server/src/bot/lifecycle.test.ts`
- Modify: `server/src/bot/bot.ts`
- Modify: `server/src/bot/notify.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Produces: `safeErrorMessage(error: unknown): string`.
- Produces: `stopBotSafely(bot: Pick<Bot, "stop">): Promise<void>`.

- [x] **Step 1: Add failing formatter and lifecycle tests**

The formatter test passes an `Error` whose message contains a Telegram API URL with a token and asserts that neither the token nor a `bot<id>:<secret>` credential pattern remains.

The lifecycle test supplies a `stop()` implementation that rejects and asserts that `stopBotSafely` resolves instead of rejecting while emitting only the sanitized message.

- [x] **Step 2: Run focused tests and confirm RED**

Run: `npx vitest run server/src/util/safe-error.test.ts server/src/bot/lifecycle.test.ts`

Expected: imports fail because the new modules do not exist.

- [x] **Step 3: Implement minimal formatter and lifecycle helper**

`safeErrorMessage` converts the error to one line and replaces Telegram bot credentials with `[REDACTED_BOT_TOKEN]`. `stopBotSafely` awaits `bot.stop()`, catches failures, and logs only `safeErrorMessage`.

- [x] **Step 4: Route every server-side Telegram error through the formatter**

Replace raw error-object logging in `bot.ts` and `notify.ts`; use `stopBotSafely` for `SIGINT` and `SIGTERM`. Existing startup and reminder logging already emits only `.message`, but pass it through the formatter for consistent redaction.

- [x] **Step 5: Run focused and full tests**

Run:

```bash
npx vitest run server/src/util/safe-error.test.ts server/src/bot/lifecycle.test.ts server/src/bot/notify.test.ts server/src/bot/bot.test.ts
npm test
```

Expected: all pass and intentional error-path tests contain no credential text.

### Task 3: Runtime hardening and deployment

**Files:**
- Permission-only: `server/.env`, `data/planer.db`, `data/planer.db-wal`, `data/planer.db-shm`, `/Users/user/planer-bot.log`

**Interfaces:**
- Consumes: verified code from Tasks 1–2.
- Produces: owner-only runtime files and a restarted healthy launchd service.

- [x] **Step 1: Run all static and build gates**

Run:

```bash
npm test
npm run typecheck
npm run build -w @planer/admin
npm run build -w @planer/miniapp
```

- [x] **Step 2: Apply owner-only permissions**

Run `chmod 600` on the environment file, live SQLite files, and service log. Do not modify their contents.

- [x] **Step 3: Restart the single launchd service**

Run: `sudo launchctl kickstart -k system/com.planerbot.server`

- [x] **Step 4: Verify production**

Verify one running listener, `/` = 302, `/api/health` = 200, `/app/` = 200, `/admin/` = 200, unauthenticated roster export = 401, SQLite `quick_check=ok`, and foreign-key check empty.

- [x] **Step 5: Review repository state**

Run `git diff --check`, inspect the diff, and confirm no secret or runtime file is tracked.

## Self-Review

- Scope covers the four explicitly approved changes: safe logs, caught shutdown, live authorization, and `0600` runtime permissions.
- Token rotation and new infrastructure automation are explicitly excluded.
- Every code behavior has a RED test before implementation.
- Middleware interfaces and all call sites change together.
