# Planer Bot: iMac release and public GitHub publication

**Date:** 2026-07-27
**Status:** approved

## Goal

Deploy the current `main` revision as one consistent release on this iMac, then
publish the sanitized source as the new public repository
`Jkaotlic/planer-bot`.

## Production rollout

The launchd service remains the only production process. The rollout sequence is:

1. Verify the current revision with tests, type checking, and both frontend builds.
2. Create an online SQLite backup and verify its integrity.
3. Restart `system/com.planerbot.server` once so the backend handlers and static
   frontend assets come from the same revision.
4. Verify a new PID, migrations, health endpoint, Mini App, admin UI, and sanitized
   startup logs.

Do not start a second bot process: two pollers using one Telegram token would
conflict.

## Public repository

The public repository contains source code and reproducible project documentation,
but no production database, logs, environment file, bot token, JWT secret,
Telegram identifiers, or real employee schedule data.

Release documentation is Russian-first and includes:

- CI, Node.js, TypeScript, and MIT license badges;
- a short product overview and feature list;
- architecture and monorepo map;
- local setup, environment variables, build, test, and deployment instructions;
- security and data-handling notes.

The repository also includes an MIT license, a safe `server/.env.example`, and a
GitHub Actions workflow that installs locked dependencies, runs tests and type
checking, and builds both frontends on Node.js 20.

## GitHub metadata

- **Owner/name:** `Jkaotlic/planer-bot`
- **Visibility:** public
- **Default branch:** `main`
- **Description:** Telegram Mini App and bot for team shift scheduling, swaps,
  duty coverage and weekend staffing.
- **Topics:** `telegram-bot`, `telegram-mini-app`, `typescript`, `react`, `hono`,
  `sqlite`, `drizzle-orm`, `shift-scheduling`, `workforce-management`

No production homepage is advertised until a stable public URL is explicitly
approved.

## Acceptance criteria

- Live service runs the new backend and frontend under one new launchd PID.
- `/api/health`, `/app/`, and `/admin/` respond successfully.
- The live database has passed backup integrity and the new migration is applied.
- The full test suite, type checking, and both production builds pass.
- A secret scan and tracked-file audit find no runtime data or credentials.
- The public GitHub repository exists, `main` is pushed, and CI is visible.
