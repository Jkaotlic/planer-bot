import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { openDb, runMigrations } from "./db/client";
import { createApp } from "./http/app";
import { assertBuilt, mountSpa } from "./http/spa";
import { createBot, publishBotCommands } from "./bot/bot";
import { shutdownSafely } from "./bot/lifecycle";
import { runReminderTick } from "./reminders/reminder-service";
import { runChecklistTick } from "./reminders/checklist-tick";
import { runCoverageAdviceTick } from "./reminders/coverage-advice";
import { runBirthdayNoticeTick } from "./birthdays/birthday-notice";
import { runHandoverTick } from "./handover/handover-tick";
import { createHandoverMessenger } from "./handover/handover-messenger";
import { teamNow } from "./util/team-time";
import { safeErrorMessage } from "./util/safe-error";
import { installFatalHandlers } from "./util/fatal-log";
import { runTicksIndependently } from "./util/ticks";

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
    // Четвёртым в тот же массив: чек-лист уходит с началом смены дежурного, а
    // не по общему часу, поэтому ему нужен тот же пятиминутный тик.
    { name: "checklist", run: () => runChecklistTick(db, bot, config, teamNow(config.teamTz)) },
    { name: "birthday", run: () => runBirthdayNoticeTick(db, bot, teamNow(config.teamTz)) },
    // Совет про пробелы графика — по тому же вечернему часу, что и напоминания.
    { name: "coverage", run: () => runCoverageAdviceTick(db, bot, teamNow(config.teamTz)) },
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

/** Путь к собранному фронту от корня репозитория — и проверка, что он собран. */
function distOf(distRelativeToRoot: string): string {
  return resolve(repoRoot, distRelativeToRoot);
}

for (const [mountName, relative] of [
  ["app", "miniapp/dist"],
  ["admin", "admin/dist"],
] as const) {
  const distDir = distOf(relative);
  assertBuilt(mountName, distDir);
  mountSpa(app, mountName, distDir);
}

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
