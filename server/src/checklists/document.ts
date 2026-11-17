import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../db/client";
import type { Checklist } from "../db/schema";
import { updateChecklist } from "../repo/checklists";

/**
 * Потолок файла инструкции.
 *
 * Пять мегабайт, а не пятьдесят, которые примет Telegram: мини-апп открывают с
 * телефона через облачный релей KeenDNS с измеренной скоростью 11–58 КБ/с, и
 * загрузка в двадцать мегабайт — это не «дольше», это полчаса занятого канала у
 * процесса, который обслуживает и API, и long-polling бота.
 */
export const MAX_DOC_BYTES = 5 * 1024 * 1024;

/** Ссылку открывают и браузер, и кнопка Telegram, поэтому адрес должен быть абсолютным. */
export function checklistDocumentUrl(value: string | null): string | null {
  if (!value || !/^(?:https?|tg):\/\/[^/\\\s][^\\\s]*$/i.test(value)) return null;
  try {
    return new URL(value).hostname ? value : null;
  } catch {
    return null;
  }
}

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

/** У каждой загрузки свой путь, чтобы запоздалый ответ Telegram не вернул старый file_id. */
export function writeChecklistDoc(docsDir: string, checklistId: number, bytes: Uint8Array): string {
  const dir = join(docsDir, String(checklistId));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, randomUUID());
  writeFileSync(path, bytes, { flag: "wx" });
  return path;
}

/**
 * Убирает прежний файл.
 *
 * `force`, потому что «файла уже нет» — не ошибка: его могли убрать руками, а
 * запись в базе всё равно надо привести в порядок.
 */
export function removeChecklistDoc(path: string | null | undefined): void {
  if (!path) return;
  try {
    rmSync(path, { force: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown";
    console.error("Не удалось удалить локальный файл инструкции:", code);
  }
}

export function setChecklistDocument(
  db: Db,
  list: Pick<Checklist, "id" | "docPath">,
  document: Pick<Checklist, "docPath" | "docName" | "docFileId">,
): void {
  try {
    updateChecklist(db, list.id, document);
  } catch (error) {
    removeChecklistDoc(document.docPath);
    throw error;
  }
  // Пока новая ссылка не записана, старая должна вести на существующий файл.
  removeChecklistDoc(list.docPath);
}
