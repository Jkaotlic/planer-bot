import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Lookbehind в регулярке (`(?<=…)`, `(?<!…)`) — Safari 16.4+. Сборка идёт под iOS 14,
 * и esbuild такую регулярку не понижает, а превращает в `new RegExp("…")`: бандл
 * парсится, но на iOS 15 бросает SyntaxError в момент вызова. Экран «QR-код» так
 * упал на монтировании, а `CrashBoundary` закрыл «Экран сломался» всё приложение.
 * Сторож смотрит исходники трёх фронтовых пакетов; артефакт сборки проверяет
 * `ops/check-bundle-baseline.mjs`.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Подстрока `(?<=` / `(?<!` — и в литерале, и в строке для `new RegExp`. */
export function hasLookbehind(code: string): boolean {
  return /\(\?<[=!]/.test(code);
}

describe("lookbehind в регулярках", () => {
  it("детектор видит литерал и строку конструктора, не трогает именованную группу", () => {
    expect(hasLookbehind("x.replace(/(?<![a-z])b/g, '')")).toBe(true);
    expect(hasLookbehind('new RegExp("(?<=a)b")')).toBe(true);
    expect(hasLookbehind("/(?<year>\\d{4})/")).toBe(false);
  });

  it("в shared, мини-аппе и консоли его нет", () => {
    const offenders = ["shared/src", "miniapp/src", "admin/src"]
      .flatMap((dir) => sources(join(root, dir)))
      .filter((file) => hasLookbehind(readFileSync(file, "utf8")))
      .map((file) => relative(root, file));
    expect(offenders).toEqual([]);
  });
});
