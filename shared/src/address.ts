/**
 * How to address a person, as opposed to how to list them.
 *
 * `displayName` comes from the roster file and is «Фамилия Имя» — correct for a
 * work roster, a column header or an export, and wrong the moment the bot says
 * hello. Taking its first word gives the SURNAME: «Привет, Петров» reads as a
 * roll-call, which is exactly the complaint this exists to fix.
 *
 * We cannot decline or reorder a name we were handed as one string, and we must
 * not guess: «Аня Смирнова» (added by hand in the bot) and «Петров Алексей» (from
 * the file) are the same shape with the parts the other way round.
 *
 * So we don't guess. Three sources, in order of how much they were chosen:
 *
 *   1. `preferredName` — what the person (or an admin) typed into «Как ко мне
 *      обращаться». Deliberate, so it wins.
 *   2. `tgFirstName` — what they called themselves in Telegram. Usually right,
 *      but not always: one of ours is «Petrov» there, and people linked before
 *      we started storing it have nothing here at all.
 *   3. `displayName` — the roster's full name. Formal, but never rude.
 */
export function addressOf(person: {
  preferredName?: string | null;
  tgFirstName?: string | null;
  displayName: string;
}): string {
  return person.preferredName?.trim() || person.tgFirstName?.trim() || person.displayName;
}

/** A phone-sized field, and a greeting is one word or two. */
export const PREFERRED_NAME_MAX = 64;

export type PreferredNameResult = { ok: true; value: string | null } | { ok: false };

/**
 * What the person typed → what we store. Blank and whitespace collapse to
 * `null`, so «стереть поле» and «очистить поле» cannot end up meaning different
 * things. Shared by the worker's own route and the admin's, because two copies
 * of a validation rule are two rules.
 */
export function normalizePreferredName(raw: unknown): PreferredNameResult {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > PREFERRED_NAME_MAX) return { ok: false };
  return { ok: true, value: trimmed };
}
