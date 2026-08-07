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

/** «Заявка на обмен — Игорь Петров, Чт 13 авг · 12:00–21:00 — отменена.» */
function cancelledLine(readerId: number, trade: SwapAuditPayload): string {
  const isInitiator = readerId === trade.fromEmployeeId;
  const otherName = isInitiator ? trade.toName : trade.fromName;
  const ownShift = isInitiator ? trade.fromShift : trade.toShift;
  return `Заявка на обмен — ${otherName}, ${ownShift} — отменена.`;
}

export function buildSwapLockNotices(input: {
  locked: boolean;
  team: readonly NoticeTarget[];
  cancelled: readonly SwapAuditPayload[];
}): OutgoingNotice[] {
  return input.team.flatMap((person) => {
    if (person.telegramUserId == null) return [];
    const lines = [input.locked ? LOCKED_HEADER : UNLOCKED_HEADER];
    if (input.locked) {
      const mine = input.cancelled.filter(
        (trade) => trade.fromEmployeeId === person.id || trade.toEmployeeId === person.id,
      );
      if (mine.length > 0) lines.push("", ...mine.map((trade) => cancelledLine(person.id, trade)));
    }
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
    const mine = input.cancelled.filter(
      (trade) => trade.fromEmployeeId === input.person.id || trade.toEmployeeId === input.person.id,
    );
    if (mine.length > 0) lines.push("", ...mine.map((trade) => cancelledLine(input.person.id, trade)));
    notices.push({ telegramUserId: input.person.telegramUserId, text: lines.join("\n") });
  }

  // The other side hears WHAT happened, never WHY: an admin's decision about one
  // person is not something the rest of the team is told.
  for (const other of input.others) {
    if (other.telegramUserId == null) continue;
    const mine = input.cancelled.filter(
      (trade) => trade.fromEmployeeId === other.id || trade.toEmployeeId === other.id,
    );
    if (mine.length === 0) continue;
    notices.push({
      telegramUserId: other.telegramUserId,
      text: mine.map((trade) => cancelledLine(other.id, trade)).join("\n"),
    });
  }

  return notices;
}
