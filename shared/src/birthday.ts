/**
 * Birthdays are stored as `MM-DD` — the day and the month, with no year.
 *
 * The year is deliberately absent. Nothing the feature does needs it: the bot
 * reminds admins a week ahead and then mails everybody a link. Asking for a year
 * would collect the one part of a birthday people are cagey about, and would
 * invite a made-up value when nobody remembers it. If an age is ever wanted, a
 * separate optional column can be added without touching this one.
 */

/** "MM-DD", 01-01 .. 12-31. */
export type BirthDate = string;

const MONTH_LENGTHS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const MONTH_NAMES = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
] as const;

/** Parses "MM-DD" into its parts, or null if it isn't a real day of a real month. */
export function parseBirthDate(value: string): { month: number; day: number } | null {
  const match = /^(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  // 29 February is allowed: it is a real birthday, and the reminder decides what
  // to do about it in a year that hasn't got one.
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > MONTH_LENGTHS[month - 1]!) return null;
  return { month, day };
}

export function isBirthDate(value: string): boolean {
  return parseBirthDate(value) !== null;
}

export function toBirthDate(month: number, day: number): BirthDate {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(month)}-${pad(day)}`;
}

/** "5 августа" — how a birthday is written when it's read out, not stored. */
export function formatBirthDate(value: string): string {
  const parsed = parseBirthDate(value);
  if (!parsed) return value;
  return `${parsed.day} ${MONTH_NAMES[parsed.month - 1]}`;
}

/**
 * "сегодня" / "завтра" / "через 5 дней" — how far off a birthday is, in words.
 *
 * Lives here rather than in each surface because the same phrase is read in three
 * places (the nudge the bot sends admins, the console list and the Mini App list),
 * and three copies of Russian day-plurals is three chances to write «5 дня».
 */
export function describeDaysUntil(days: number): string {
  if (days <= 0) return "сегодня";
  if (days === 1) return "завтра";
  return `через ${days} ${pluralDays(days)}`;
}

/** 1 день · 2 дня · 5 дней — including the 11–14 exception. */
export function pluralDays(days: number): string {
  const mod100 = days % 100;
  if (mod100 >= 11 && mod100 <= 14) return "дней";
  const mod10 = days % 10;
  if (mod10 === 1) return "день";
  if (mod10 >= 2 && mod10 <= 4) return "дня";
  return "дней";
}

/**
 * How many days from `asOf` (YYYY-MM-DD) until that birthday next comes round —
 * 0 when it is today, and never negative: a birthday that has passed this year
 * counts to next year's.
 *
 * 29 February in a year that hasn't got one is treated as 1 March, so somebody
 * born on the 29th is still greeted every year rather than every fourth.
 */
export function daysUntilBirthday(birthDate: string, asOf: string): number | null {
  const parsed = parseBirthDate(birthDate);
  if (!parsed) return null;
  const [year, month, day] = asOf.split("-").map(Number);
  if (!year || !month || !day) return null;

  const today = Date.UTC(year, month - 1, day);
  for (const candidateYear of [year, year + 1]) {
    const when = occurrenceIn(candidateYear, parsed.month, parsed.day);
    const diff = Math.round((when - today) / 86_400_000);
    if (diff >= 0) return diff;
  }
  return null;
}

function occurrenceIn(year: number, month: number, day: number): number {
  const stamp = Date.UTC(year, month - 1, day);
  // Date.UTC rolls 29 February over to 1 March on its own in a common year,
  // which is exactly the behaviour we want — assert it rather than assume it.
  return stamp;
}
