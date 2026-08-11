import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Границы пакетов держатся тестом, а не обещанием.
 *
 * Повод не теоретический: ровно так один и тот же тип успел стать `Category` в
 * мини-аппе и `EntryCategory` в админке — никто не запрещал, и разошлось молча.
 */
describe("границы пакетов", () => {
  it("shared не знает про браузер", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(repoRoot, "shared/src"))) {
      const text = readFileSync(file, "utf8");
      for (const banned of ["localStorage", "window.", "document.", "import.meta"]) {
        if (text.includes(banned)) {
          offenders.push(`${file.replace(`${repoRoot}/`, "")}: ${banned}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("server не импортирует клиентский пакет", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(repoRoot, "server/src"))) {
      if (readFileSync(file, "utf8").includes("@planer/client")) {
        offenders.push(file.replace(`${repoRoot}/`, ""));
      }
    }
    expect(offenders).toEqual([]);
  });
});
