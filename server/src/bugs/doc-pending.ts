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
const KEY = "checklist_doc_pending";

/** Пятнадцать минут — ровно как у багрепорта: «отвлёкся, вернулся и прислал». */
export const DOC_PENDING_TTL_MS = 15 * 60_000;

export function startDocPending(db: Db, employeeId: number, checklistId: number): void {
  const value = `${employeeId}:${checklistId}`;
  db.insert(appSettings)
    .values({ key: KEY, value, updatedByEmployeeId: employeeId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedByEmployeeId: employeeId, updatedAt: new Date() } })
    .run();
}

/** Номер чек-листа, которого ждут от этого админа, или `null`. */
export function docPendingFor(db: Db, employeeId: number, now: Date): number | null {
  const row = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  if (!row) return null;
  const [who, checklistId] = row.value.split(":");
  if (who !== String(employeeId)) return null;
  if (now.getTime() - row.updatedAt.getTime() >= DOC_PENDING_TTL_MS) return null;
  const parsed = Number(checklistId);
  return Number.isFinite(parsed) ? parsed : null;
}

export function clearDocPending(db: Db): void {
  db.delete(appSettings).where(eq(appSettings.key, KEY)).run();
}
