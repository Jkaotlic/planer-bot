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
 * So we don't guess. Telegram already knows what the person calls themselves —
 * `first_name`, which they chose — and we store it on link and refresh it on
 * every auth. When it is missing (a roster row nobody has linked yet) the full
 * name is used: formal, but never rude.
 */
export function addressOf(person: { tgFirstName?: string | null; displayName: string }): string {
  return person.tgFirstName?.trim() || person.displayName;
}
