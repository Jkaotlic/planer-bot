import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { openDb, runMigrations } from "./db/client";
import { seedDefaultTemplates } from "./db/seed";
import { createApp } from "./http/app";
import { createBot } from "./bot/bot";

const config = loadConfig(process.env);
const { db, sqlite } = openDb(config.databaseUrl);
runMigrations(db, sqlite);
seedDefaultTemplates(db);

const bot = createBot({ db, config });
process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
// Long-polling runs in the background; a bad/placeholder token must not crash the HTTP server.
bot.start({ onStart: (info) => console.log(`bot @${info.username} started`) }).catch((err) => {
  console.error("bot failed to start (check BOT_TOKEN):", err instanceof Error ? err.message : err);
});

const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid PORT: ${JSON.stringify(process.env.PORT)}`);
serve({ fetch: createApp({ db, config }).fetch, port });
console.log(`planer-bot server listening on :${port}`);
