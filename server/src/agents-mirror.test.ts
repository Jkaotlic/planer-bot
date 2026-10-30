import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * CLAUDE.md и AGENTS.md — одни и те же правила для двух агентов: первый читает
 * Claude, второй Codex. Глобальных правил Codex не видит, поэтому его файл не может
 * быть «короче, остальное возьмёт оттуда». Просьба «правь оба» в самих файлах
 * ничего не гарантирует: разъезд замечают, только когда агенты уже ведут себя
 * по-разному. Сравниваем всё, кроме третьей строки — там каждый файл называет
 * своего напарника, и это единственное законное различие.
 */
const repoRoot = resolve(__dirname, "../..");
const read = (name: string): string[] =>
  readFileSync(resolve(repoRoot, name), "utf8").split("\n");

describe("CLAUDE.md и AGENTS.md не разъехались", () => {
  it("совпадают построчно, кроме строки, где каждый называет напарника", () => {
    const claude = read("CLAUDE.md");
    const agents = read("AGENTS.md");

    expect(claude[2]).toContain("`AGENTS.md`");
    expect(agents[2]).toContain("`CLAUDE.md`");

    const withoutMirrorLine = (lines: string[]) => lines.filter((_, i) => i !== 2);
    expect(withoutMirrorLine(agents)).toEqual(withoutMirrorLine(claude));
  });
});
