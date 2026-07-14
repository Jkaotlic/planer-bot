import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import { loadConfig } from "./config";
import { openDb, runMigrations } from "./db/client";
import { seedDefaultTemplates } from "./db/seed";
import { createApp } from "./http/app";
import { createBot } from "./bot/bot";
import type { Env } from "./http/middleware";

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
serve({ fetch: app.fetch, port });
console.log(`planer-bot server listening on :${port}`);
