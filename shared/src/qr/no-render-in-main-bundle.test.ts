import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Основной бандл мини-аппа тянет `@planer/shared` (корень) и из него `qr/style.ts`
 * (тип `Me`, схема ответа). Библиотека `qrcode` и рисование живут в `qr/render.ts` и
 * доступны только по отдельному входу `@planer/shared/qr` из ленивого экрана. Любая
 * статическая дорожка от корня или от `style.ts` к `render` — прямая, через
 * `export *` или цепочку файлов — молча вернула бы `qrcode` в основной бандл: сборка
 * этого не заметит, заметят только владельцы медленных телефонов.
 */
const shared = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const render = resolve(shared, "qr/render.ts");

/** Статические указатели: `import … from`, `export … from`, `import "x"`; динамический `import()` не считается. */
export function staticSpecifiers(code: string): string[] {
  const out: string[] = [];
  const re = /\b(?:import|export)\s+(?:type\s+)?(?:[^;'"`]*?\sfrom\s*)?(["'])([^"'\n]+)\1/g;
  for (const m of code.matchAll(re)) out.push(m[2]!);
  return out;
}

function resolveRelative(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier).replace(/\.tsx?$/, "");
  for (const candidate of [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Всё, что статически достижимо из входа, и внешние пакеты по дороге. */
export function reachable(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of staticSpecifiers(readFileSync(file, "utf8"))) {
      if (specifier.startsWith(".")) {
        const target = resolveRelative(file, specifier);
        if (target) queue.push(target);
      } else {
        packages.add(specifier);
      }
    }
  }
  return { files, packages };
}

describe("детектор достижимости", () => {
  it("идёт по export * и цепочке файлов, динамический import() не считает", () => {
    expect(staticSpecifiers(`export * from "./qr/render";`)).toEqual(["./qr/render"]);
    expect(staticSpecifiers(`export { renderQr } from './render.ts';`)).toEqual(["./render.ts"]);
    expect(staticSpecifiers(`import QRCode from "qrcode";`)).toEqual(["qrcode"]);
    expect(staticSpecifiers(`const m = await import("./qr/render");`)).toEqual([]);
  });

  it("корень достигает style.ts — иначе сторож проверял бы пустоту", () => {
    expect(reachable(resolve(shared, "index.ts")).files.has(resolve(shared, "qr/style.ts"))).toBe(true);
  });
});

describe("основной бандл не тянет рисование QR", () => {
  for (const entry of ["index.ts", "qr/style.ts"]) {
    it(`${entry}: нет статической дорожки к qr/render и к qrcode`, () => {
      const { files, packages } = reachable(resolve(shared, entry));
      expect([...files].map((f) => relative(shared, f))).not.toContain(relative(shared, render));
      expect([...packages].filter((p) => p === "qrcode" || p.startsWith("qrcode/"))).toEqual([]);
    });
  }
});
