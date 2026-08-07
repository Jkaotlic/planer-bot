import type { SwapAuditPayload } from "../util/message-lines";

/**
 * What goes out when an admin closes swaps, or takes one person out of them.
 *
 * Pure on purpose — no database, no bot, no clock. The route reads the team, the
 * lock service returns the cancelled trades, and this decides who hears what. It
 * is the only place that knows the wording, so a change lands on every path.
 *
 * ONE message per person, never one per request: the schedule-change feature
 * settled that rule, and somebody with two open trades is exactly the case that
 * makes three near-identical messages arrive in the same second.
 *
 * Names stay in the nominative. We store one display name and nothing that would
 * let us decline it, and «заявка с Игорь Петров» is the sort of thing that gets
 * noticed when it lands in 25 chats at once — same rule as `defaultMessage` in
 * the birthday service.
 */

export interface NoticeTarget {
  id: number;
  telegramUserId: number | null;
}

export interface OutgoingNotice {
  telegramUserId: number;
  text: string;
}

const LOCKED_HEADER = [
  "🔒 Обмены смен закрыты.",
  "Пока админ не откроет их обратно, предложить или принять обмен нельзя.",
].join("\n");

const UNLOCKED_HEADER = "🔓 Обмены смен снова открыты.";

/**
 * One cancelled trade, from the reader's side: the OTHER person's name and the
 * reader's OWN shift — «Заявка на обмен — Игорь Петров, Чт 13 авг · 12:00–21:00 —
 * отменена.» On the other phone the same trade reads the other way round.
 */
function cancelledLine(readerId: number, trade: SwapAuditPayload): string {
  const isInitiator = readerId === trade.fromEmployeeId;
  const otherName = isInitiator ? trade.toName : trade.fromName;
  const ownShift = isInitiator ? trade.fromShift : trade.toShift;
  return `Заявка на обмен — ${otherName}, ${ownShift} — отменена.`;
}

/**
 * Every cancelled trade this person was part of, already worded for them.
 *
 * All three recipient paths below need exactly this, and three copies of
 * «filter by id, map through cancelledLine» is three chances for them to drift
 * on who counts as involved — which is how one path ended up appending lines
 * regardless of whether anything had actually been cancelled.
 */
function linesFor(personId: number, cancelled: readonly SwapAuditPayload[]): string[] {
  return cancelled
    .filter((trade) => trade.fromEmployeeId === personId || trade.toEmployeeId === personId)
    .map((trade) => cancelledLine(personId, trade));
}

export function buildSwapLockNotices(input: {
  locked: boolean;
  team: readonly NoticeTarget[];
  cancelled: readonly SwapAuditPayload[];
}): OutgoingNotice[] {
  return input.team.flatMap((person) => {
    if (person.telegramUserId == null) return [];
    const lines = [input.locked ? LOCKED_HEADER : UNLOCKED_HEADER];
    // Unlocking cancels nothing, so there is never anything to append to it.
    const mine = input.locked ? linesFor(person.id, input.cancelled) : [];
    if (mine.length > 0) lines.push("", ...mine);
    return [{ telegramUserId: person.telegramUserId, text: lines.join("\n") }];
  });
}

export function buildExclusionNotices(input: {
  excluded: boolean;
  person: NoticeTarget;
  others: readonly NoticeTarget[];
  cancelled: readonly SwapAuditPayload[];
}): OutgoingNotice[] {
  const notices: OutgoingNotice[] = [];

  if (input.person.telegramUserId != null) {
    const lines = [
      input.excluded
        ? "🔒 Тебе закрыли обмены смен. Если это ошибка — напиши админу."
        : "🔓 Тебе снова доступны обмены смен.",
    ];
    // Same guard as the lock builder: clearing the flag cancels nothing, so
    // «снова доступны» must never grow a list of cancelled requests under it.
    const mine = input.excluded ? linesFor(input.person.id, input.cancelled) : [];
    if (mine.length > 0) lines.push("", ...mine);
    notices.push({ telegramUserId: input.person.telegramUserId, text: lines.join("\n") });
  }

  // The other side hears WHAT happened, never WHY: an admin's decision about one
  // person is not something the rest of the team is told.
  for (const other of input.others) {
    if (other.telegramUserId == null) continue;
    const mine = linesFor(other.id, input.cancelled);
    if (mine.length === 0) continue;
    notices.push({
      telegramUserId: other.telegramUserId,
      text: mine.join("\n"),
    });
  }

  return notices;
}
