import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { appSettings } from "../db/schema";

/**
 * Инструкция дежурного: пояснение текстом, ссылка на документ и файл в Telegram.
 *
 * В `app_settings`, а не своей таблицей: это одна настройка команды на всю
 * систему, а не сущность со своей жизнью. Отсутствующая строка означает
 * «не задано», никогда «сломано» — тот же приём, что у `swaps_locked`.
 */
const NOTE = "checklist_note";
const DOC_URL = "checklist_doc_url";
const DOC_FILE_ID = "checklist_doc_file_id";
const DOC_NAME = "checklist_doc_name";
const DOC_PENDING = "checklist_doc_pending";

/**
 * Столько живёт окно ожидания файла — ровно как у багрепорта, и по той же
 * причине: пятнадцать минут это «отвлёкся, вернулся и прислал», но не «через
 * два часа случайно отправил боту договор аренды».
 */
export const DOC_PENDING_TTL_MS = 15 * 60_000;

export interface ChecklistSettings {
  /** Пояснение на весь чек-лист. */
  note: string | null;
  /** Ссылка на документ в облаке. */
  docUrl: string | null;
  /** Файл, лежащий в Telegram: бот пересылает его дежурному по этому идентификатору. */
  docFileId: string | null;
  docName: string | null;
}

export function readChecklistSettings(db: Db): ChecklistSettings {
  const rows = db
    .select()
    .from(appSettings)
    .where(inArray(appSettings.key, [NOTE, DOC_URL, DOC_FILE_ID, DOC_NAME]))
    .all();
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const read = (key: string) => byKey.get(key) || null;
  return { note: read(NOTE), docUrl: read(DOC_URL), docFileId: read(DOC_FILE_ID), docName: read(DOC_NAME) };
}

/** Пустая строка стирает настройку: «задано пустым» и «не задано» — одно и то же. */
function put(db: Db, key: string, value: string | null, actorEmployeeId: number): void {
  const clean = value?.trim();
  if (!clean) {
    db.delete(appSettings).where(eq(appSettings.key, key)).run();
    return;
  }
  db.insert(appSettings)
    .values({ key, value: clean, updatedByEmployeeId: actorEmployeeId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: clean, updatedByEmployeeId: actorEmployeeId, updatedAt: new Date() },
    })
    .run();
}

export function saveChecklistText(
  db: Db,
  input: { note: string | null; docUrl: string | null },
  actorEmployeeId: number,
): void {
  put(db, NOTE, input.note, actorEmployeeId);
  put(db, DOC_URL, input.docUrl, actorEmployeeId);
}

export function saveChecklistDoc(
  db: Db,
  input: { fileId: string; fileName: string | null },
  actorEmployeeId: number,
): void {
  put(db, DOC_FILE_ID, input.fileId, actorEmployeeId);
  put(db, DOC_NAME, input.fileName ?? "Инструкция", actorEmployeeId);
}

export function clearChecklistDoc(db: Db, actorEmployeeId: number): void {
  put(db, DOC_FILE_ID, null, actorEmployeeId);
  put(db, DOC_NAME, null, actorEmployeeId);
}

/**
 * Бот попросил файл: следующий документ ОТ ЭТОГО админа станет инструкцией.
 *
 * Окно в базе, а не в памяти процесса: рестарт посреди разговора иначе молча
 * съедал бы присланный файл, и человек не понял бы, почему.
 */
export function startDocPending(db: Db, employeeId: number): void {
  put(db, DOC_PENDING, String(employeeId), employeeId);
}

export function docPendingFor(db: Db, employeeId: number, now: Date): boolean {
  const row = db.select().from(appSettings).where(eq(appSettings.key, DOC_PENDING)).get();
  if (!row || row.value !== String(employeeId)) return false;
  return now.getTime() - row.updatedAt.getTime() < DOC_PENDING_TTL_MS;
}

export function clearDocPending(db: Db): void {
  db.delete(appSettings).where(eq(appSettings.key, DOC_PENDING)).run();
}
