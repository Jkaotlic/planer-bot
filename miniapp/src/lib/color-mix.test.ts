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
const here = dirname(fileURLToPath(import.meta.url));
// Мини-апп и консоль: встроенные стили есть в обеих мордах, а сборка видит только CSS.
const roots = [resolve(here, ".."), resolve(here, "../../../admin/src")];

function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .filter((name): name is string => typeof name === "string" && /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => join(dir, name));
}

describe("color-mix во встроенных стилях", () => {
  it("каждая строка со смесью идёт через mixOr с запасным значением", () => {
    const offenders = roots.flatMap((root) =>
      sources(root)
        .filter((file) => !file.endsWith(join("lib", "color-mix.ts")))
        .flatMap((file) => {
          const lines = readFileSync(file, "utf8").split("\n");
          return lines
            .map((line, index) => ({ line, index }))
            .filter(({ line }) => line.includes("color-mix(") && !/^\s*(\/\/|\*)/.test(line))
            // Разрешено ровно два вида: смесь на той же строке, что и `mixOr(`, или смесь —
            // первый аргумент, когда предыдущая строка ЗАКАНЧИВАЕТСЯ на `mixOr(`. Просто
            // упоминание `mixOr` выше не спасает: соседнее свойство так проходило молча.
            .filter(({ line, index }) => !line.includes("mixOr(") && !(lines[index - 1] ?? "").trimEnd().endsWith("mixOr("))
            .map(({ index }) => `${file.slice(root.length + 1)}:${index + 1}`);
        }),
    );
    expect(offenders).toEqual([]);
  });
});
