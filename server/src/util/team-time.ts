/** Team-timezone wall-clock "now" as { date: "YYYY-MM-DD", time: "HH:MM" }. */
export function teamNow(teamTz: string): { date: string; time: string } {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: teamTz }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: teamTz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  return { date, time };
}

/**
 * Часы команды для произвольного момента.
 *
 * Отдельно от `teamNow`, потому что вопрос другой: не «сколько сейчас», а «во
 * сколько это случилось». Приводится там же, где живёт правило про командную
 * дату, — иначе фронт начал бы гадать про пояс по часам браузера.
 *
 * Число — секунды эпохи, как их хранит SQLite; `Date` — то, что отдаёт drizzle
 * для колонок `mode: "timestamp"`. Принимаются оба, чтобы вызывающий не считал
 * миллисекунды в уме.
 */
export function teamTimeAt(at: Date | number, teamTz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: teamTz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(typeof at === "number" ? new Date(at * 1000) : at);
}
