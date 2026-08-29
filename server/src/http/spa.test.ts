import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, it, expect } from "vitest";
import { mountSpa } from "./spa";
import type { Env } from "./middleware";

function distWith(assetName: string): string {
  const dir = mkdtempSync(join(tmpdir(), "spa-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><html><body><div id=\"root\"></div></body></html>");
  writeFileSync(join(dir, "assets", assetName), "export const ok = 1;\n");
  return dir;
}

function appWith(dist: string): Hono<Env> {
  const app = new Hono<Env>();
  mountSpa(app, "app", dist);
  return app;
}

/**
 * Ассет, которого нет, обязан отвечать 404 — и вот почему это не педантизм.
 *
 * Раздача SPA отдаёт `index.html` на любой неузнанный путь, чтобы работала
 * навигация внутри приложения. Пока это правило распространялось и на
 * `/app/assets/*`, запрос старого файла (браузер держит прежний `index.html`, а
 * сборка уже сменила хеши — обычное дело в минуту выкатки) получал в ответ
 * HTML со статусом 200 и заголовком `immutable` на год. Браузер грузит его как
 * модуль, спотыкается о `<!doctype`, и человек видит белый экран — тот самый,
 * неотличимый от всех остальных.
 */
describe("раздача собранного фронта", () => {
  it("отдаёт существующий ассет как есть", async () => {
    const app = appWith(distWith("index-AAA111.js"));
    const res = await app.request("/app/assets/index-AAA111.js");

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("export const ok");
  });

  it("на пропавший ассет отвечает 404, а не разметкой под видом модуля", async () => {
    const app = appWith(distWith("index-AAA111.js"));
    const res = await app.request("/app/assets/index-OLDHASH.js");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").not.toContain("text/html");
  });

  it("не велит кэшировать промах на год — иначе поломка переживёт починку", async () => {
    const app = appWith(distWith("index-AAA111.js"));
    const res = await app.request("/app/assets/index-OLDHASH.js");

    expect(res.headers.get("cache-control") ?? "").not.toContain("immutable");
  });

  it("внутренний маршрут приложения по-прежнему получает index.html", async () => {
    const app = appWith(distWith("index-AAA111.js"));
    const res = await app.request("/app/somewhere");

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<div id=\"root\">");
  });

  it("сам index.html кэшировать запрещено — иначе выкатка не доедет", async () => {
    const app = appWith(distWith("index-AAA111.js"));
    const res = await app.request("/app/");

    expect(res.headers.get("cache-control") ?? "").toContain("no-store");
  });
});
