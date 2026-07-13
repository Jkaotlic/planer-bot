import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { openDb, runMigrations } from "./db/client";
import { seedDefaultTemplates } from "./db/seed";
import { createApp } from "./http/app";

const config = loadConfig(process.env);
const { db } = openDb(config.databaseUrl);
runMigrations(db);
seedDefaultTemplates(db);

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: createApp({ db, config }).fetch, port });
console.log(`planer-bot server listening on :${port}`);
