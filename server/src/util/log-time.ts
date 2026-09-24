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

type LogTarget = { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

export function installLogTimestamps(target: LogTarget, timeZone: string, now: () => Date = () => new Date()): void {
  for (const level of ["log", "error"] as const) {
    const original = target[level].bind(target);
    target[level] = (...args: unknown[]) => original(`[${logStamp(now(), timeZone)}]`, ...args);
  }
}
