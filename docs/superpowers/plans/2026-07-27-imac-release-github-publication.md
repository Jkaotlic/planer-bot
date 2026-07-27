# Planer Bot iMac release and GitHub publication plan

**Goal:** Restore a consistent production release on the iMac and publish a
release-ready, sanitized public repository.

**Architecture:** Keep launchd as the single production supervisor, use an online
SQLite backup before migration/restart, and publish the existing npm workspace
monorepo with CI and operator documentation.

---

## 1. Establish deployment evidence

- Record the live PID and start time.
- Compare it with the current backend and frontend build timestamps.
- Verify the current database integrity.
- Create and integrity-check an online SQLite backup.

## 2. Verify and restart production

- Run `npm test`.
- Run `npm run typecheck`.
- Build `@planer/miniapp` and `@planer/admin`.
- Restart only `system/com.planerbot.server`.
- Verify the new PID, listener, health route, both SPAs, migrations, and sanitized
  startup logs.

## 3. Prepare the public release surface

- Add a Russian-first `README.md` with badges, features, architecture, setup,
  operation, testing, and security notes.
- Add `server/.env.example` with placeholders only.
- Add `LICENSE` (MIT).
- Add `.github/workflows/ci.yml` for Node.js 20.

## 4. Audit publication contents

- Re-run tests, type checking, and both builds.
- Confirm `.env`, SQLite databases and sidecars, logs, backups, and build outputs
  are untracked.
- Scan tracked text for credential patterns and machine-specific private data.
- Review the final diff and repository metadata.

## 5. Publish

- Commit the release documentation and CI intentionally on `main`.
- Create public repository `Jkaotlic/planer-bot`.
- Add `origin`, push `main`, set the repository description and topics.
- Verify the remote branch, README rendering, and CI run.
