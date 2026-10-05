import { InlineKeyboard } from "grammy";
import { sickSpanShort, sickSpanWords, type SickSpan } from "@planer/shared";

/**
 * Where the «выбери коллег» button lands: the sick-leave form's second step, loaded
 * from the server. A query parameter, like every other bot deep link (`?screen=sick`),
 * because Telegram owns the fragment.
 */
export function handoverDraftsLink(publicUrl: string): string {
  return `${publicUrl}/app/?screen=handovers`;
}

/** One function for the first send and every redraw, so the callback strings cannot drift apart. */
export function sickApprovalKeyboard(entryId: number): InlineKeyboard {
  return new InlineKeyboard().text("✅ ОК", `sick:approve:${entryId}`).text("❌ Отклонить", `sick:reject:${entryId}`);
}

/**
 * The single letter admins get for a worker's sick leave (spec item 17): it replaces the old
 * «работник выпал из смены» notice and carries the same per-day lines, so nothing the admin
 * used to learn from that notice is lost.
 */
export function sickApprovalText(
  name: string,
  entry: { date: string; endDate: string | null },
  dayLines: readonly string[],
  observer: boolean,
  extension: readonly SickSpan[] | null = null,
): string {
  return [
    // An extension names only the days nobody has approved yet: the rest is old news.
    extension
      ? `🤒 ${name} — продление больничного: ${extension.map((run) => sickSpanShort(run.date, run.endDate)).join(", ")}`
      : `🤒 ${name} — больничный ${sickSpanShort(entry.date, entry.endDate)}`,
    ...dayLines,
    // An observer hands nothing over, so promising a hand-over would be untrue.
    observer ? "Нужен ОК любого админа." : "Передача смен начнётся после ОК.",
  ].join("\n");
}

/**
 * The worker is no longer in the form when the «ОК» lands, so the letter carries the
 * way back to the step the form used to show right away. «подтвердил(а)»: the database
 * holds a name and nothing to derive gender from — the same convention as every other
 * letter of this bot (`поставил(а)`, `снял(а)`).
 */
export function sickApprovedWorkerText(
  entry: { date: string; endDate: string | null },
  adminName: string,
  hasDrafts: boolean,
  extension: readonly SickSpan[] | null = null,
): string {
  const head = extension
    ? `✅ Продление больничного ${extension.map((run) => sickSpanWords(run.date, run.endDate)).join(" и ")} подтвердил(а) ${adminName}.`
    : `✅ Больничный ${sickSpanWords(entry.date, entry.endDate)} подтвердил(а) ${adminName}.`;
  return hasDrafts ? `${head} Выбери, кому предложить смены` : head;
}

export function handoverDraftsKeyboard(publicUrl: string): InlineKeyboard {
  return new InlineKeyboard().webApp("🤝 Выбрать коллег", handoverDraftsLink(publicUrl));
}

/** The edited letter once the worker took the extension back: the request is closed, the approved days stay. */
export function sickExtensionWithdrawnText(name: string, entry: { date: string; endDate: string | null }): string {
  return `🤒 ${name} — продление больничного снято, ОК не нужен\nБольничный ${sickSpanWords(entry.date, entry.endDate)} подтверждён раньше.`;
}

/** Spec item 10, with the neutral verb and no gendered pronoun (controller ruling). */
export function sickRejectedWorkerText(
  entry: { date: string; endDate: string | null },
  adminName: string,
  extension: readonly SickSpan[] | null = null,
): string {
  const subject = extension
    ? `Продление больничного ${extension.map((run) => sickSpanWords(run.date, run.endDate)).join(" и ")}`
    : `Больничный ${sickSpanWords(entry.date, entry.endDate)}`;
  return `${subject} не подтвердил(а) ${adminName} — напиши, чтобы разобраться.`;
}
