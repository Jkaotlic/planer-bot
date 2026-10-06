/**
 * Метка времени у каждой строки `~/planer-bot.log`.
 *
 * Launchd пишет stdout/stderr в файл как есть, без времени. 7 сентября «когда
 * замолчал бот» восстанавливали по `reminder_log.sent_at`, 24-го — по счёту
 * повторов тика чек-листа. Время командное, как всё остальное в сервисе
 * (`teamNow`): инцидент обсуждается в часах команды, а не машины.
 */
export function logStamp(at: Date, timeZone: string): string {
  // sv-SE даёт ровно «YYYY-MM-DD HH:MM:SS» — без ручной сборки из частей.
  return at.toLocaleString("sv-SE", { timeZone, hour12: false });
}

type LogFn = (...args: unknown[]) => void;
type LogTarget = { log: LogFn; error: LogFn; warn?: LogFn };

export function installLogTimestamps(target: LogTarget, timeZone: string, now: () => Date = () => new Date()): void {
  // `warn` тоже: через него пишет `/api/client-error` («мини-апп не запустился»), и без
  // метки такой отчёт 2026-10-06 датировался только «между 08:32 и 15:46».
  for (const level of ["log", "error", "warn"] as const) {
    const fn = target[level];
    if (!fn) continue;
    const original = fn.bind(target);
    target[level] = (...args: unknown[]) => original(`[${logStamp(now(), timeZone)}]`, ...args);
  }
}
