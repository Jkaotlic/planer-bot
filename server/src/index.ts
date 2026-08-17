import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import { loadConfig } from "./config";
import { openDb, runMigrations } from "./db/client";
import { createApp } from "./http/app";
import { createBot, publishBotCommands } from "./bot/bot";
import { shutdownSafely } from "./bot/lifecycle";
import { runReminderTick } from "./reminders/reminder-service";
import { runBirthdayNoticeTick } from "./birthdays/birthday-notice";
import { runHandoverTick } from "./handover/handover-tick";
import { createHandoverMessenger } from "./handover/handover-messenger";
import { teamNow } from "./util/team-time";
import { safeErrorMessage } from "./util/safe-error";
import { installFatalHandlers } from "./util/fatal-log";
import { runTicksIndependently } from "./util/ticks";
import type { Env } from "./http/middleware";

// Первым делом, до чтения конфига: сорваться можно уже на нём, а сорванный дамп
// печатает Node сам и несёт в логе токен бота открытым текстом.
installFatalHandlers();

const config = loadConfig(process.env);
const { db, sqlite } = openDb(config.databaseUrl);
runMigrations(db, sqlite);

const bot = createBot({ db, config });
// Long-polling runs in the background; a bad/placeholder token must not crash the HTTP server.
bot.start({
  onStart: (info) => {
    console.log(`bot @${info.username} started`);
    void publishBotCommands(bot);
  },
}).catch((err) => {
  console.error("bot failed to start (check BOT_TOKEN):", safeErrorMessage(err));
});

// Soft evening-before reminders and the birthday nudges — polled every 5 minutes;
// a failed tick must not crash the server, and a slow batch must not overlap the
// next one. The two ticks run independently (see runTicksIndependently) so a
// failure in one — e.g. the reminder tick throwing — cannot suppress the other;
// previously they were chained with `.then()`, which skipped the birthday tick
// entirely whenever the reminder tick rejected.
const REMINDER_TICK_MS = 5 * 60 * 1000;
let ticking = false;
setInterval(() => {
  if (ticking) return;
  ticking = true;
  runTicksIndependently([
    { name: "reminder", run: () => runReminderTick(db, bot, teamNow(config.teamTz)) },
    { name: "birthday", run: () => runBirthdayNoticeTick(db, bot, teamNow(config.teamTz).date) },
    // Третьим в тот же массив, а не своим setInterval: `runTicksIndependently`
    // и написан затем, чтобы падение одного тика не гасило соседей.
    {
      name: "handover",
      run: () => runHandoverTick({ db, config, messenger: createHandoverMessenger(bot, db) }, Date.now()),
    },
  ]).finally(() => {
    ticking = false;
  });
}, REMINDER_TICK_MS);

const app = createApp({ db, config, bot });

// Serve the built mini app (/app) and admin (/admin) SPAs from this same process.
// This file lives at <repoRoot>/server/src/index.ts, so the repo root is always two
// directories up from here — independent of cwd (npm workspace scripts run with cwd
// set to the workspace dir, e.g. <repoRoot>/server, not the repo root).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function mountSpa(app: Hono<Env>, mountName: string, distRelativeToRoot: string): void {
  const distDir = resolve(repoRoot, distRelativeToRoot);
  if (!existsSync(distDir)) {
    throw new Error(
      `Missing built frontend for "/${mountName}": ${distDir} does not exist. ` +
        `Run "npm run build --workspace @planer/${mountName === "app" ? "miniapp" : mountName}" first.`,
    );
  }
  const prefix = `/${mountName}`;
  const stripPrefix = new RegExp(`^${prefix}`);

  app.get(prefix, (c) => c.redirect(`${prefix}/`));
  // Cache policy: Vite's hashed assets are immutable and cached hard, but the
  // HTML shell must always revalidate — otherwise Telegram's mini-app webview
  // keeps serving a stale index.html that points at old asset hashes, so a new
  // deploy (e.g. a freshly added tab) never shows up until the user clears cache.
  app.use(`${prefix}/*`, async (c, next) => {
    await next();
    const isHashedAsset = c.req.path.includes(`${prefix}/assets/`);
    c.header("Cache-Control", isHashedAsset ? "public, max-age=31536000, immutable" : "no-cache, no-store, must-revalidate");
  });
  // Static assets (js/css/images/etc) served straight from dist.
  app.use(`${prefix}/*`, serveStatic({ root: distDir, rewriteRequestPath: (p) => p.replace(stripPrefix, "") }));
  // SPA fallback: any unmatched sub-path (client-side route, or a hard refresh on one) gets index.html.
  app.get(`${prefix}/*`, serveStatic({ root: distDir, path: "index.html" }));
}

mountSpa(app, "app", "miniapp/dist");
mountSpa(app, "admin", "admin/dist");

app.get("/", (c) => c.redirect("/app/"));

const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid PORT: ${JSON.stringify(process.env.PORT)}`);
const server = serve({ fetch: app.fetch, port });
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  void shutdownSafely({
    bot,
    closeHttp: () =>
      new Promise<void>((resolveShutdown, rejectShutdown) => {
        server.close((error) => {
          if (error) rejectShutdown(error);
          else resolveShutdown();
        });
      }),
    closeDb: () => sqlite.close(),
    exit: (code) => process.exit(code),
  });
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
console.log(`planer-bot server listening on :${port}`);
