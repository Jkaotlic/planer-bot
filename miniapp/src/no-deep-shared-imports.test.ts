import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Единственный разрешённый вход в рисование QR — `@planer/shared/qr` из ленивого
 * экрана. Глубокий импорт `@planer/shared/src/...` обходит и `exports` пакета, и
 * сторожей бандла (`qr-bundle.test.ts`, `shared/src/qr/no-render-in-main-bundle.test.ts`):
 * `render.ts` с `qrcode` приехал бы в основной бандл, а сборка промолчала бы.
 */
const src = dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Любое упоминание глубокого пути: статический import, `export … from`, `import()`, `require`. */
export function hasDeepSharedImport(code: string): boolean {
  return /@planer\/shared\/src\//.test(code);
}

describe("глубокие импорты shared", () => {
  it("детектор видит путь в любой записи", () => {
    expect(hasDeepSharedImport(`import { x } from "@planer/shared/src/qr/render";`)).toBe(true);
    expect(hasDeepSharedImport(`const m = import('@planer/shared/src/index');`)).toBe(true);
    expect(hasDeepSharedImport(`import { x } from "@planer/shared/qr";`)).toBe(false);
    expect(hasDeepSharedImport(`import { x } from "@planer/shared";`)).toBe(false);
  });

  it("в исходниках мини-аппа их нет", () => {
    const offenders = sources(src)
      .filter((file) => hasDeepSharedImport(readFileSync(file, "utf8")))
      .map((file) => relative(resolve(src, ".."), file));
    expect(offenders).toEqual([]);
  });
});
