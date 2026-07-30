import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";

/**
 * Никакого настоящего ФИО в репозитории.
 *
 * Репозиторий публичный, а живая база — это ростер команды. Один раз имена уже
 * протекли: они разошлись по спекам, планам, докстрингам и тестам как «удобный
 * пример», и заметить это глазами нельзя — фамилия в комментарии выглядит ровно
 * как выдуманная. Поэтому проверку делает машина, и проверяет она не список
 * запрещённых слов (он бы сам стал утечкой), а факт: **ни одна фамилия из живой
 * базы не встречается ни в одном файле под git**.
 *
 * Тест опирается на локальную БД и потому пропускается там, где её нет — в CI, у
 * нового разработчика, в чистом клоне. Это осознанно: он ловит того единственного,
 * кто может занести имя внутрь, — человека, у которого настоящая база под рукой.
 *
 * Одни имена (без фамилии) не проверяются намеренно: в команде из тридцати человек
 * любое правдоподобное русское имя кого-нибудь да совпадёт, а имя само по себе
 * никого не опознаёт. Опознают фамилия, полное ФИО, телеграм-хендл и telegram id —
 * их и ищем.
 */
const repoRoot = resolve(__dirname, "../../..");
const dbPath = resolve(repoRoot, "data/planer.db");
const hasLiveDb = existsSync(dbPath);

describe.skipIf(!hasLiveDb)("в git не лежит ни одного настоящего имени", () => {
  const identifiers = (): string[] => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db
        .prepare(
          `select display_name as displayName, tg_username as tgUsername, telegram_user_id as tgId
             from employees`,
        )
        .all() as { displayName: string; tgUsername: string | null; tgId: number | null }[];
      const out = new Set<string>();
      for (const row of rows) {
        if (row.displayName?.startsWith("__TEST")) continue;
        // «Фамилия Имя» — фамилия и есть опознавательный токен, плюс ФИО целиком.
        const surname = row.displayName?.trim().split(/\s+/)[0];
        if (surname && surname.length >= 4) out.add(surname);
        if (row.displayName?.trim()) out.add(row.displayName.trim());
        if (row.tgUsername && row.tgUsername.length >= 4) out.add(row.tgUsername);
        if (row.tgId != null) out.add(String(row.tgId));
      }
      return [...out];
    } finally {
      db.close();
    }
  };

  it("не находит ни фамилии, ни хендла, ни telegram id из живой базы", () => {
    const needles = identifiers();
    expect(needles.length).toBeGreaterThan(0); // иначе тест ничего не доказывает

    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
      .split("\0")
      .filter(Boolean)
      // LICENSE и копирайт в README называют автора проекта — это авторство, а не ростер.
      .filter((path) => path !== "LICENSE");

    const found: string[] = [];
    for (const path of tracked) {
      let text: string;
      try {
        // Файлы читаются с диска, а не из HEAD: смысл в том, чтобы поймать имя
        // до коммита, а не рассказать про уже уехавший.
        text = readFileSync(resolve(repoRoot, path), "utf8");
      } catch {
        continue; // удалён из дерева или бинарник — читать нечего
      }
      for (const needle of needles) {
        // Имя нарушителя в сообщение не попадает: оно ушло бы в лог CI и в
        // историю терминала, то есть ровно туда, откуда мы имена и убираем.
        if (text.includes(needle)) found.push(path);
      }
    }

    expect([...new Set(found)]).toEqual([]);
  });
});
