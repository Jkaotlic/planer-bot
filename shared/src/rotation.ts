/**
 * Whose turn it is for a kind of shift.
 *
 * The bot only ever *suggests* this — it never assigns a duty itself. So this is
 * deliberately a plain ordering, not a scheduler: "who has gone longest without
 * doing it", which is what a person means by «чья очередь».
 */

export type RotationUnit = "day" | "week";

export interface RotationCandidate {
  employeeId: number;
  displayName: string;
  /** Their place in the admin's list — the tiebreak, so equals read in roster order. */
  rosterOrder: number | null;
  /** The last day they held this kind, or null if they never have. */
  lastHeld: string | null;
}

export interface RotationTurn extends RotationCandidate {
  /** Days since they last held it; null when they never have. */
  daysSince: number | null;
}

/** Whole days between two YYYY-MM-DD dates. */
function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * Orders candidates by whose turn it is: anyone who has never held this kind
 * first, then whoever held it longest ago. Equal claims fall back to the admin's
 * own list order, so the answer is stable and explainable rather than arbitrary.
 *
 * Pure, and takes `asOf` rather than reading the clock, so a suggestion made on
 * a Monday can be reproduced on a Friday.
 */
export function rotationQueue(candidates: readonly RotationCandidate[], asOf: string): RotationTurn[] {
  return [...candidates]
    .map((candidate) => ({
      ...candidate,
      daysSince: candidate.lastHeld ? daysBetween(candidate.lastHeld, asOf) : null,
    }))
    .sort((a, b) => {
      if (a.lastHeld === null && b.lastHeld === null) return byRoster(a, b);
      if (a.lastHeld === null) return -1;
      if (b.lastHeld === null) return 1;
      return a.lastHeld.localeCompare(b.lastHeld) || byRoster(a, b);
    });
}

function byRoster(a: RotationCandidate, b: RotationCandidate): number {
  const left = a.rosterOrder ?? Number.MAX_SAFE_INTEGER;
  const right = b.rosterOrder ?? Number.MAX_SAFE_INTEGER;
  return left - right || a.employeeId - b.employeeId;
}

/**
 * "Мишин (ещё не дежурил)" / "Лапин (15 дней назад)" — one candidate, the way the
 * hint reads it out. `unit` only changes the wording, never the order: a weekly
 * duty is handed out a week at a time, so "давно" is counted in weeks.
 */
export function describeTurn(turn: RotationTurn, unit: RotationUnit): string {
  if (turn.daysSince === null) return `${turn.displayName} (ещё не дежурил)`;
  if (turn.daysSince === 0) return `${turn.displayName} (сегодня)`;
  if (unit === "week") {
    const weeks = Math.floor(turn.daysSince / 7);
    if (weeks >= 1) return `${turn.displayName} (${weeks} ${plural(weeks, "неделя", "недели", "недель")} назад)`;
  }
  return `${turn.displayName} (${turn.daysSince} ${plural(turn.daysSince, "день", "дня", "дней")} назад)`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
