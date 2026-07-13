import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { openDb, runMigrations } from "./db/client";
import { seedDefaultTemplates } from "./db/seed";
import { createApp } from "./http/app";

const config = loadConfig(process.env);
const { db, sqlite } = openDb(config.databaseUrl);
runMigrations(db, sqlite);
seedDefaultTemplates(db);

const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid PORT: ${JSON.stringify(process.env.PORT)}`);
serve({ fetch: createApp({ db, config }).fetch, port });
console.log(`planer-bot server listening on :${port}`);
