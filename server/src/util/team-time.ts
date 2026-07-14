/** Team-timezone wall-clock "now" as { date: "YYYY-MM-DD", time: "HH:MM" }. */
export function teamNow(teamTz: string): { date: string; time: string } {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: teamTz }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: teamTz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  return { date, time };
}
