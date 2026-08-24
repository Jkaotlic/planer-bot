import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Потолок файла инструкции.
 *
 * Пять мегабайт, а не пятьдесят, которые примет Telegram: мини-апп открывают с
 * телефона через облачный релей KeenDNS с измеренной скоростью 11–58 КБ/с, и
 * загрузка в двадцать мегабайт — это не «дольше», это полчаса занятого канала у
 * процесса, который обслуживает и API, и long-polling бота.
 */
export const MAX_DOC_BYTES = 5 * 1024 * 1024;

/**
 * Имя файла, пришедшее из браузера, — это ввод пользователя, а не имя файла.
 *
 * `split` по обоим разделителям, а не `basename`: имя приходит от клиента, и
 * windows-обратные слэши в нём для сервера на macOS — обычные символы, из
 * которых `basename` путь не увидит. Пустое имя заменяется словом: файл без
 * имени в сообщении дежурному выглядел бы поломкой.
 */
export function safeDocName(raw: string): string {
  const base = raw.split(/[\\/]/).pop()?.trim() ?? "";
  return base.length > 0 ? base.slice(0, 120) : "Инструкция";
}

/** Куда лечь файлу этого чек-листа. Каталог на чек-лист — чтобы имена не сталкивались. */
export function checklistDocPath(docsDir: string, checklistId: number, name: string): string {
  return join(docsDir, String(checklistId), name);
}

/** Пишет файл, создавая каталог. Возвращает путь, который лёг в базу. */
export function writeChecklistDoc(docsDir: string, checklistId: number, name: string, bytes: Uint8Array): string {
  const path = checklistDocPath(docsDir, checklistId, name);
  mkdirSync(join(docsDir, String(checklistId)), { recursive: true });
  writeFileSync(path, bytes);
  return path;
}

/**
 * Убирает прежний файл.
 *
 * `force`, потому что «файла уже нет» — не ошибка: его могли убрать руками, а
 * запись в базе всё равно надо привести в порядок.
 */
export function removeChecklistDoc(path: string | null | undefined): void {
  if (path) rmSync(path, { force: true });
}
