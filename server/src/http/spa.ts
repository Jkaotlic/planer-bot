import { existsSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import type { Env } from "./middleware";

/**
 * Раздача собранного фронта тем же процессом, что и API.
 *
 * Живёт отдельным модулем, а не внутри `index.ts`, ровно ради проверяемости:
 * `index.ts` при импорте поднимает сервер и бота, и написать про раздачу тест
 * было негде. Шов появился, когда выяснилось, что промах по ассету отвечает
 * разметкой вместо модуля — см. ниже.
 */
export function mountSpa(app: Hono<Env>, mountName: string, distDir: string): void {
  const prefix = `/${mountName}`;
  const stripPrefix = new RegExp(`^${prefix}`);
  const assetsPrefix = `${prefix}/assets/`;

  app.get(prefix, (c) => c.redirect(`${prefix}/`));

  // Cache policy: Vite's hashed assets are immutable and cached hard, but the
  // HTML shell must always revalidate — otherwise Telegram's mini-app webview
  // keeps serving a stale index.html that points at old asset hashes, so a new
  // deploy (e.g. a freshly added tab) never shows up until the user clears cache.
  //
  // `immutable` ставится только на успешный ответ. На промахе он превращал
  // ошибку в вечную: браузер запомнил бы «по этому адресу лежит вот это» на год.
  app.use(`${prefix}/*`, async (c, next) => {
    await next();
    const isHashedAsset = c.req.path.startsWith(assetsPrefix) && c.res.status === 200;
    c.header("Cache-Control", isHashedAsset ? "public, max-age=31536000, immutable" : "no-cache, no-store, must-revalidate");
  });

  // Static assets (js/css/images/etc) served straight from dist.
  app.use(`${prefix}/*`, serveStatic({ root: distDir, rewriteRequestPath: (p) => p.replace(stripPrefix, "") }));

  /**
   * Промах по `assets/` — это 404, и только 404.
   *
   * Ниже стоит SPA-фолбэк: любой неузнанный путь получает `index.html`, иначе
   * не работала бы навигация внутри приложения. Но на `assets/` это правило
   * оборачивалось бедой. Браузер держит прежний `index.html` (в минуту выкатки —
   * обычное дело), просит по нему файл со старым хешем, а получает разметку со
   * статусом 200 и типом `text/html`. Модуль, начинающийся с `<!doctype`, не
   * парсится — и человек видит белый экран, неотличимый от всех остальных
   * белых экранов. Проверено на живом проде до починки: `curl` по выдуманному
   * хешу отвечал 200, `text/html`, 873 байта и `immutable` на год.
   */
  app.get(`${assetsPrefix}*`, (c) => c.text("not found", 404));

  // SPA fallback: any unmatched sub-path (client-side route, or a hard refresh on one) gets index.html.
  app.get(`${prefix}/*`, serveStatic({ root: distDir, path: "index.html" }));
}

/** Бросает, если фронт не собран: сервер без него отдаёт пустоту и молчит об этом. */
export function assertBuilt(mountName: string, distDir: string): void {
  if (existsSync(distDir)) return;
  throw new Error(
    `Missing built frontend for "/${mountName}": ${distDir} does not exist. ` +
      `Run "npm run build --workspace @planer/${mountName === "app" ? "miniapp" : mountName}" first.`,
  );
}
