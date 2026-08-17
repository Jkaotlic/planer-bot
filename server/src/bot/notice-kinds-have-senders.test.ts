import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_NOTICE_KINDS, type AdminNoticeKind } from "@planer/shared";

/**
 * Сторож против вида уведомления, у которого нет отправителя.
 *
 * Такой дефект уже случался, 2026-08-17: вид `celebrations` был объявлен, получил
 * подпись и тумблер в мини-аппе — а письма про дни рождения уходили мимо
 * `notifyAdmins`, своим циклом, и выключатель не делал ничего. Поймал это человек,
 * читавший спеку, а не гейт. Следующий раз может не повезти: добавить вид в массив
 * дешевле, чем вспомнить, что его ещё надо кому-то отправлять.
 *
 * Проверка грубая, и это осознанный выбор. Настоящее доказательство — «на каждый вид
 * реально уходит письмо» — требует интеграционного теста на каждое из шести событий
 * (обмен, выходная, самозапись, передача, сбор, багрепорт), то есть работы на порядок
 * большей, чем цена ошибки. Здесь проверяется то, что ловит наблюдавшийся дефект:
 * упоминается ли вид хоть где-то среди файлов, которые вообще умеют писать админам.
 *
 * Чего эта проверка НЕ поймает: вид, который где-то фильтруется, но никогда не
 * отправляется. Чтобы так ошибиться, надо написать фильтр для письма, которого не
 * существует, — ошибка другого рода и куда менее вероятная.
 */

const SERVER_SRC = join(import.meta.dirname, "..");

/** Все `.ts` в `server/src`, кроме тестов. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

/**
 * Файлы, которые умеют писать админам: те, где есть вызов `notifyAdmins` или
 * `noticeMuteKeyboard`.
 *
 * Отбор именно по этим двум именам, а не «любой файл», не случаен. Иначе сторож
 * зеленел бы от одного лишь упоминания вида в фильтре — а `collection-service.ts`
 * ровно такой: он зовёт `isNoticeMuted(..., "celebrations")`, но сам никому не пишет.
 * Тогда декоративный вид, из-за которого этот тест и написан, снова прошёл бы.
 */
function senderFiles(): { path: string; text: string }[] {
  return sourceFiles(SERVER_SRC)
    .map((path) => ({ path, text: readFileSync(path, "utf8") }))
    .filter(({ text }) => text.includes("notifyAdmins(") || text.includes("noticeMuteKeyboard("));
}

describe("у каждого вида уведомления есть отправитель", () => {
  it("вид упоминается хотя бы в одном файле, который пишет админам", () => {
    const senders = senderFiles();
    // Если отбор однажды перестанет находить файлы вовсе (переименовали функцию,
    // переехали каталоги), тест обязан упасть здесь, а не молча пройти на пустом
    // списке: перебор ниже по пустому множеству зелен для любого вида.
    expect(senders.length).toBeGreaterThan(0);

    const orphans = ADMIN_NOTICE_KINDS.filter(
      (kind: AdminNoticeKind) => !senders.some(({ text }) => text.includes(`"${kind}"`)),
    );

    expect(
      orphans,
      `Вид объявлен, но им никто не пишет: ${orphans.join(", ")}. ` +
        "Либо добавь отправителя, либо убери вид — иначе в мини-аппе появится тумблер, который ничего не делает.",
    ).toEqual([]);
  });
});
