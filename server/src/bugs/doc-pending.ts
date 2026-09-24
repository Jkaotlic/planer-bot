import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { appSettings } from "../db/schema";

/**
 * Окно «жду файл»: бот попросил инструкцию, и следующий документ ОТ ЭТОГО
 * админа приложится К ЭТОМУ чек-листу.
 *
 * Окно, а не «любой документ от админа»: админы шлют боту файлы и по другим
 * поводам, и молча превращать чужой PDF в инструкцию для всей смены нельзя.
 *
 * В базе, а не в памяти процесса: рестарт посреди разговора иначе съедал бы
 * присланный файл молча, и человек не понял бы, почему.
 */
/**
 * Ключ — на админа. Был один на всех: пока админ А искал файл, админ Б жал
 * «приложить» к другому списку или «убрать файл» — и файл А молча никуда не
 * прикладывался. Старая общая строка `checklist_doc_pending`, если осталась в
 * базе, больше не читается: окно живёт пятнадцать минут, терять нечего.
 */
const keyOf = (employeeId: number) => `checklist_doc_pending:${employeeId}`;

/** Пятнадцать минут — ровно как у багрепорта: «отвлёкся, вернулся и прислал». */
export const DOC_PENDING_TTL_MS = 15 * 60_000;

export function startDocPending(db: Db, employeeId: number, checklistId: number): void {
  const value = String(checklistId);
  db.insert(appSettings)
    .values({ key: keyOf(employeeId), value, updatedByEmployeeId: employeeId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedByEmployeeId: employeeId, updatedAt: new Date() } })
    .run();
}

/** Номер чек-листа, которого ждут от этого админа, или `null`. */
export function docPendingFor(db: Db, employeeId: number, now: Date): number | null {
  const row = db.select().from(appSettings).where(eq(appSettings.key, keyOf(employeeId))).get();
  if (!row) return null;
  if (now.getTime() - row.updatedAt.getTime() >= DOC_PENDING_TTL_MS) return null;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function clearDocPending(db: Db, employeeId: number): void {
  db.delete(appSettings).where(eq(appSettings.key, keyOf(employeeId))).run();
}
