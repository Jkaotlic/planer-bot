import { categoryAccusative, type EntryCategory } from "@planer/shared";
import { dayLabel } from "../util/message-lines";

export interface SelfEntryLike {
  category: EntryCategory;
  date: string;
  endDate?: string | null;
  title?: string | null;
  start?: string | null;
  end?: string | null;
  location?: string | null;
}

/**
 * «больничный» / «мероприятие «Конференция»» — what the entry is called mid-sentence.
 *
 * An event is named by the words the person typed. The category word alone would
 * make every event letter read the same, and «какое именно» is the admin's very
 * first question.
 */
function subjectOf(entry: SelfEntryLike): string {
  const word = categoryAccusative(entry.category);
  return entry.title ? `${word} «${entry.title}»` : word;
}

/**
 * «Ср 12 авг – Пт 14 авг · 14:00–16:00 · Поклонка» — when it is, as precisely as
 * the entry itself knows.
 *
 * A one-day span is written once rather than as a range from itself to itself:
 * «Ср 12 авг – Ср 12 авг» reads as a bug even though it is arithmetically true.
 */
function whenOf(entry: SelfEntryLike): string {
  const span =
    entry.endDate && entry.endDate !== entry.date
      ? `${dayLabel(entry.date)} – ${dayLabel(entry.endDate)}`
      : dayLabel(entry.date);
  const hours = entry.start && entry.end ? ` · ${entry.start}–${entry.end}` : "";
  const place = entry.location ? ` · ${entry.location}` : "";
  return `${span}${hours}${place}`;
}

/**
 * The letter admins get when somebody records their own absence or event.
 *
 * `dayLines` is the important half, not decoration: it is what names the shift
 * left with nobody on it. Until the handover feature exists (заход 3), this
 * letter is the ONLY thing that reports an uncovered shift at all.
 *
 * «поставил(а)» rather than a gendered verb — the same form the rest of this bot
 * uses, because the database holds a name and nothing to derive gender from.
 */
export function selfEntryCreatedText(actorName: string, entry: SelfEntryLike, dayLines: string[]): string {
  return [`${actorName} поставил(а) себе ${subjectOf(entry)}: ${whenOf(entry)}.`, ...dayLines].join("\n");
}

export function selfEntryUpdatedText(
  actorName: string,
  before: SelfEntryLike,
  after: SelfEntryLike,
  dayLines: string[],
): string {
  return [
    `${actorName} изменил(а) себе ${subjectOf(after)}: было ${whenOf(before)} → стало ${whenOf(after)}.`,
    ...dayLines,
  ].join("\n");
}

/** No day lines here on purpose: nothing was added, so nothing is newly at risk. */
export function selfEntryDeletedText(actorName: string, entry: SelfEntryLike): string {
  return `${actorName} снял(а) с себя ${subjectOf(entry)}: ${whenOf(entry)}.`;
}
