import type { Db } from "../db/client";
import { getShift } from "../repo/shifts";
import { getEmployeeById } from "../repo/employees";

/**
 * "Пн 13 июл · 08:00–17:00"-style short line describing a shift, for chat
 * notifications and the audit journal — a line that reads without a join
 * back to `shifts`.
 *
 * Shared by the HTTP layer and the bot's own callback handlers so a swap
 * resolved either way produces the exact same wording.
 */
export function shiftLineOf(db: Db, shiftId: number): string {
  const shift = getShift(db, shiftId);
  if (!shift) return "смену";
  const parts = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .formatToParts(new Date(`${shift.date}T00:00:00Z`));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  const dateLabel = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${get("day")} ${get("month").replace(/\.$/, "")}`;
  const time = shift.start != null && shift.end != null ? ` · ${shift.start}–${shift.end}` : "";
  return `${dateLabel}${time}`;
}

/** "Сб 19 июл · 10:00–18:00 · Ярмарка" — short line describing a vacant slot
 *  (or any slot-shaped record) for chat and the audit journal. */
export function slotLineOf(s: { date: string; start: string; end: string; title?: string | null }): string {
  const parts = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .formatToParts(new Date(`${s.date}T00:00:00Z`));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  const dateLabel = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${get("day")} ${get("month").replace(/\.$/, "")}`;
  const title = s.title ? ` · ${s.title}` : "";
  return `${dateLabel} · ${s.start}–${s.end}${title}`;
}

/** An employee's display name for chat text, or null if the id doesn't resolve. */
export function nameOf(db: Db, employeeId: number): string | null {
  return getEmployeeById(db, employeeId)?.displayName ?? null;
}

/**
 * Both sides of a swap, by name and by shift line — a journal row (or a chat
 * message built from it) reads on its own, with no join back to employees or
 * shifts.
 *
 * Shared by the mini-app's HTTP routes and the bot's own accept/decline
 * buttons, so a swap resolved either way leaves the same trail — see the
 * "no second payload format" rule in `bot.ts`'s swap callback handler.
 */
export function swapAuditPayload(
  db: Db,
  request: { id: number; fromEmployeeId: number; toEmployeeId: number; fromShiftId: number; toShiftId: number },
) {
  return {
    requestId: request.id,
    fromEmployeeId: request.fromEmployeeId,
    fromName: nameOf(db, request.fromEmployeeId) ?? "Неизвестно",
    fromShift: shiftLineOf(db, request.fromShiftId),
    toEmployeeId: request.toEmployeeId,
    toName: nameOf(db, request.toEmployeeId) ?? "Неизвестно",
    toShift: shiftLineOf(db, request.toShiftId),
  };
}

export type SwapAuditPayload = ReturnType<typeof swapAuditPayload>;
