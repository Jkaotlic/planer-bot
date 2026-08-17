import { and, desc, eq, gte, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { bugReportPending, bugReports, type BugReport } from "../db/schema";

/**
 * Открывает (или переоткрывает) окно ожидания для этого человека.
 *
 * `onConflictDoUpdate` по `employeeId`, а не отдельный insert/update: второе
 * нажатие кнопки должно заменить старое приглашение новым, а не завести вторую
 * строку — см. комментарий у `bugReportPending` в схеме.
 */
export function upsertPending(db: Db, employeeId: number, promptMessageId: number, now: Date): void {
  db.insert(bugReportPending)
    .values({ employeeId, promptMessageId, createdAt: now })
    .onConflictDoUpdate({
      target: bugReportPending.employeeId,
      set: { promptMessageId, createdAt: now },
    })
    .run();
}

export function selectPending(db: Db, employeeId: number): { promptMessageId: number; createdAt: Date } | undefined {
  return db
    .select({ promptMessageId: bugReportPending.promptMessageId, createdAt: bugReportPending.createdAt })
    .from(bugReportPending)
    .where(eq(bugReportPending.employeeId, employeeId))
    .get();
}

export function deletePending(db: Db, employeeId: number): void {
  db.delete(bugReportPending).where(eq(bugReportPending.employeeId, employeeId)).run();
}

export function insertReport(db: Db, employeeId: number, text: string, now: Date): BugReport {
  return db.insert(bugReports).values({ employeeId, text, createdAt: now }).returning().all()[0]!;
}

/**
 * Сколько багрепортов этот человек прислал начиная с момента `since`.
 *
 * `createdAt` в базе — секунды (`unixepoch()`), а окно потолка меряется в
 * миллисекундах: тест «шестой за час, а через час снова можно» нарочно бьёт
 * ровно по границе часа плюс миллисекунда. Наивный `gte(createdAt, since)`
 * пропускает `since` через тот же секундный маппер, что и колонку, и округляет
 * его вниз — до той же секунды, что и у самой старой записи, которую окно как
 * раз должно было исключить. Поэтому SQL берёт только грубую границу с запасом
 * в секунду, а точное решение — здесь, в JS, на настоящих миллисекундах.
 */
export function countReportsSince(db: Db, employeeId: number, since: Date): number {
  return db
    .select({ createdAt: bugReports.createdAt })
    .from(bugReports)
    .where(and(eq(bugReports.employeeId, employeeId), gte(bugReports.createdAt, new Date(since.getTime() - 1000))))
    .all()
    .filter((row) => row.createdAt.getTime() >= since.getTime()).length;
}

/** `open` — только нерешённые, свежие сверху. `all` — вся история, тоже свежие сверху. */
export function selectReports(db: Db, status: "open" | "all"): BugReport[] {
  return db
    .select()
    .from(bugReports)
    .where(status === "open" ? isNull(bugReports.resolvedAt) : undefined)
    .orderBy(desc(bugReports.createdAt), desc(bugReports.id))
    .all();
}

export function updateResolved(
  db: Db,
  id: number,
  patch: { resolvedAt: Date | null; resolvedByEmployeeId: number | null },
): BugReport | undefined {
  return db.update(bugReports).set(patch).where(eq(bugReports.id, id)).returning().get();
}
