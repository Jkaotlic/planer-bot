import type { Db } from "../db/client";
import type { BugReport } from "../db/schema";
import { recordAudit } from "../repo/audit";
import {
  countReportsSince,
  deletePending,
  insertReport,
  selectPending,
  selectReports,
  updateResolved,
  upsertPending,
} from "../repo/bugs";
import { nameOf } from "../util/message-lines";

/** Столько живёт окно ожидания. Пятнадцать минут — это «отвлёкся, вернулся и
 *  дописал», но не «через два часа случайно рассказал боту про обед». */
export const BUG_PENDING_TTL_MS = 15 * 60_000;

/** Лимит Telegram — 4096; здесь запас, потому что текст ещё едет админам с
 *  приклеенным именем автора. */
export const BUG_TEXT_MAX = 2000;

/**
 * Единственное место в системе, где работник может слать админам произвольный
 * текст. Без потолка одна раздражённая пятиминутка превращается в тридцать
 * сообщений в чате у каждого админа.
 */
export const BUG_REPORTS_PER_HOUR = 5;

export interface BugReportView {
  report: BugReport;
  authorName: string;
  resolvedByName: string | null;
}

/** Бот задал вопрос «что не так» — открывает (или переоткрывает) окно ожидания. */
export function openBugPrompt(db: Db, employeeId: number, promptMessageId: number, now: Date): void {
  upsertPending(db, employeeId, promptMessageId, now);
}

export function getBugPending(db: Db, employeeId: number): { promptMessageId: number; createdAt: Date } | null {
  return selectPending(db, employeeId) ?? null;
}

export function clearBugPending(db: Db, employeeId: number): void {
  deletePending(db, employeeId);
}

/**
 * Считать ли это сообщение багрепортом.
 *
 * Чистая функция от окна, реплая и времени — чтобы правило проверялось напрямую,
 * а не через перехват апдейтов Telegram.
 *
 * Реплай засчитывается независимо от возраста окна: `message_id` — однозначное
 * доказательство, что человек отвечает именно на приглашение. Окно нужно только
 * второму пути, где такого доказательства нет.
 *
 * Час здесь и в потолке ниже — реальное истёкшее время, а не командная дата:
 * оба меряют темп, а не календарь. Это единственное место в проекте, где
 * `teamNow` намеренно не при чём.
 */
export function shouldCapture(
  pending: { promptMessageId: number; createdAt: Date },
  replyToMessageId: number | undefined,
  now: Date,
): boolean {
  if (replyToMessageId === pending.promptMessageId) return true;
  if (replyToMessageId !== undefined) return false;
  return now.getTime() - pending.createdAt.getTime() <= BUG_PENDING_TTL_MS;
}

export type SubmitOutcome = { ok: true; report: BugReport } | { ok: false; reason: string };

/**
 * Принимает багрепорт: непустой после `trim`, не длиннее лимита, не превышает
 * потолок в час — и только потом пишет. Отказы — готовой русской фразой, как в
 * `handover-service`: боту переводить нечего.
 */
export function submitBugReport(db: Db, employeeId: number, text: string, now: Date): SubmitOutcome {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "Текст пуст — напиши, что именно не так" };
  }
  if (trimmed.length > BUG_TEXT_MAX) {
    return { ok: false, reason: `Слишком длинно — уложись в ${BUG_TEXT_MAX} символов` };
  }
  const since = new Date(now.getTime() - 3600_000);
  if (countReportsSince(db, employeeId, since) >= BUG_REPORTS_PER_HOUR) {
    return { ok: false, reason: "Слишком много сообщений подряд — попробуй через час" };
  }

  const report = insertReport(db, employeeId, trimmed, now);
  recordAudit(db, "bug_report_created", employeeId, { text: trimmed });
  return { ok: true, report };
}

/** `open` — только нерешённые, свежие сверху. `all` — вся история. */
export function listBugReports(db: Db, status: "open" | "all"): BugReportView[] {
  return selectReports(db, status).map((report) => ({
    report,
    authorName: nameOf(db, report.employeeId) ?? `работник #${report.employeeId}`,
    resolvedByName:
      report.resolvedByEmployeeId != null ? (nameOf(db, report.resolvedByEmployeeId) ?? `работник #${report.resolvedByEmployeeId}`) : null,
  }));
}

/** «Разобрал» / «снова открыть» — переключатель, а не одноразовое действие. */
export function resolveBugReport(db: Db, id: number, adminId: number, resolved: boolean, now: Date): BugReport | null {
  const updated = updateResolved(db, id, {
    resolvedAt: resolved ? now : null,
    resolvedByEmployeeId: resolved ? adminId : null,
  });
  if (!updated) return null;
  recordAudit(db, "bug_report_resolved", adminId, { text: updated.text, resolved });
  return updated;
}
