import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Сторож встроенных стилей: `color-mix(` в `style={{…}}` — только через `mixOr`.
 * Safari < 16.2 выбрасывает такое значение целиком: у плашки приветствия так
 * пропадал весь фон (белый текст на белом). CSS-файлы проверяет сборка
 * (`ops/check-bundle-baseline.mjs`), встроенные стили она не видит — поэтому тест.
 */
const src = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .filter((name): name is string => typeof name === "string" && /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => join(dir, name));
}

describe("color-mix во встроенных стилях", () => {
  it("каждая строка со смесью идёт через mixOr с запасным значением", () => {
    const offenders = sources(src)
      .filter((file) => !file.endsWith(join("lib", "color-mix.ts")))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .map((line, index) => ({ file, line, index }))
          .filter(({ line }) => line.includes("color-mix(") && !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
          .filter(({ file, line, index }) => {
            // Смесь может стоять на строке после `mixOr(` — смотрим и на неё.
            const prev = readFileSync(file, "utf8").split("\n")[index - 1] ?? "";
            return !line.includes("mixOr(") && !prev.includes("mixOr(");
          })
          .map(({ file, index }) => `${file.slice(src.length + 1)}:${index + 1}`),
      );
    expect(offenders).toEqual([]);
  });
});
