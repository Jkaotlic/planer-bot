/**
 * Everything a handover says to a human.
 *
 * Only string building lives here — no database, no Telegram — so the wording can
 * be checked directly instead of through an intercepted send.
 *
 * The shift is always passed in as an already-built line (`entryLineOf`), never
 * re-formatted here: one entry must be named the same way in every message. The
 * swap feature paid for the other approach — its buttons offered a duty without
 * saying it was a duty.
 */

/** Sent to the one colleague the person picked. */
export function handoverOfferText(fromName: string, shiftLine: string): string {
  return [`${fromName} заболел(а). Возьмёшь смену?`, shiftLine].join("\n");
}

/**
 * Sent to everybody free once the addressee went silent or said no.
 *
 * Deliberately impersonal: everyone free gets this text, and «тебе предложили»
 * would be a lie in a broadcast — the first person to tap takes it.
 */
export function handoverFanText(fromName: string, shiftLine: string): string {
  return [`Смена без человека — ${fromName} на больничном.`, shiftLine, "Кто может выйти?"].join("\n");
}

export function handoverTakenTextForTaker(shiftLine: string): string {
  return ["Смена теперь твоя.", shiftLine].join("\n");
}

/** «поставил(а)» form throughout: the database holds a name and nothing to derive gender from. */
export function handoverTakenTextForGiver(takerName: string, shiftLine: string): string {
  return [`${takerName} взял(а) твою смену.`, shiftLine].join("\n");
}

export function handoverTakenTextForAdmins(takerName: string, fromName: string, shiftLine: string): string {
  return [`${takerName} взял(а) смену за ${fromName}.`, shiftLine].join("\n");
}

/**
 * The letter the whole feature exists for: a shift nobody took.
 *
 * Refusals are named one by one, because «двое отказались» sends the admin back
 * to the console to find out who. The silent ones are a number: their names
 * answer nothing — they simply have not tapped.
 *
 * With nobody on either list the letter says so plainly. «Отказались: » with an
 * empty tail reads as lost data, and an admin who sees it starts looking for a
 * bug instead of for a person.
 */
export function handoverEscalationText(
  fromName: string,
  shiftLine: string,
  declined: readonly string[],
  silentCount: number,
): string {
  const lines = [`⚠️ Смена без человека — нужно решение.`, shiftLine, `${fromName} на больничном.`];
  if (declined.length > 0) lines.push(`Отказались: ${declined.join(", ")}.`);
  if (silentCount > 0) lines.push(`Молчат: ещё ${silentCount}.`);
  if (declined.length === 0 && silentCount === 0) lines.push("Предложить было некому — все заняты.");
  return lines.join("\n");
}

/** Sent to everybody already asked when the sick leave went away. */
export function handoverCancelledText(fromName: string, shiftLine: string): string {
  return [`Смену выходить не нужно — ${fromName} снял(а) больничный.`, shiftLine].join("\n");
}
