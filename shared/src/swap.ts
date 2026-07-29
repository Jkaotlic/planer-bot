import type { SwapStatus, SwapEvent, Shift } from "./types";
import type { EntryCategory } from "./category";
import { shiftsOverlap, shiftInterval } from "./overlap";
import { absMinutes } from "./time";

const TRANSITIONS: Record<SwapStatus, Partial<Record<SwapEvent, SwapStatus>>> = {
  pending: { accept: "accepted", decline: "declined", cancel: "cancelled", expire: "expired" },
  accepted: {},
  declined: {},
  cancelled: {},
  expired: {},
};

export function nextSwapStatus(current: SwapStatus, event: SwapEvent): SwapStatus {
  const next = TRANSITIONS[current][event];
  if (!next) {
    throw new Error(`Invalid swap transition: "${current}" + "${event}"`);
  }
  return next;
}

export type SwapRejectReason =
  | "from-shift-not-owned"
  | "to-shift-not-owned"
  | "from-shift-in-past"
  | "to-shift-in-past"
  | "double-booking-from"
  | "double-booking-to"
  | "identical-shift";

export type SwapValidation = { ok: true } | { ok: false; reason: SwapRejectReason };

/**
 * The subset of a shift needed to tell whether two shifts are "the same kind"
 * (see `isIdenticalShift`). Deliberately structural rather than tied to
 * `Shift`, so both the server's DB row and the miniapp's lighter client-side
 * shape can be passed in without a conversion step.
 */
export interface ShiftKind {
  date: string;
  templateId: number | null;
  category: EntryCategory;
  start: string | null;
  end: string | null;
}

/**
 * A swap that would leave both people holding exactly what they started
 * with: the two shifts fall on the same date AND are the same "kind".
 *
 * "Same kind":
 * - if either shift has a preset (`templateId`), the kind IS the preset —
 *   compare `templateId` alone. Two unrelated presets can coincidentally
 *   share a time (and would wrongly compare equal by time alone), but a
 *   preset is the actual identity of a shift in this project.
 * - only when BOTH shifts are hand-made (no preset) do we fall back to
 *   `category` + `start` + `end`.
 *
 * Deliberately NOT flagged: the same preset on a *different* day (trading
 * which day you work is the whole point of swaps), or two different presets
 * on the same day (that changes both people's hours).
 */
export function isIdenticalShift(a: ShiftKind, b: ShiftKind): boolean {
  if (a.date !== b.date) return false;
  if (a.templateId != null || b.templateId != null) return a.templateId === b.templateId;
  return a.category === b.category && a.start === b.start && a.end === b.end;
}

export interface SwapContext {
  fromShift: Shift & Pick<ShiftKind, "category">;
  toShift: Shift & Pick<ShiftKind, "category">;
  fromEmployeeId: number;
  toEmployeeId: number;
  /** initiator's other shifts (excluding fromShift) */
  fromOtherShifts: Shift[];
  /** counterparty's other shifts (excluding toShift) */
  toOtherShifts: Shift[];
  /** current team wall-clock time */
  now: { date: string; time: string };
}

export function validateSwap(ctx: SwapContext): SwapValidation {
  const { fromShift, toShift, fromEmployeeId, toEmployeeId, fromOtherShifts, toOtherShifts, now } = ctx;

  if (fromShift.employeeId !== fromEmployeeId) return { ok: false, reason: "from-shift-not-owned" };
  if (toShift.employeeId !== toEmployeeId) return { ok: false, reason: "to-shift-not-owned" };

  const nowAbs = absMinutes(now.date, now.time);
  if (shiftInterval(fromShift).start <= nowAbs) return { ok: false, reason: "from-shift-in-past" };
  if (shiftInterval(toShift).start <= nowAbs) return { ok: false, reason: "to-shift-in-past" };

  if (isIdenticalShift(fromShift, toShift)) return { ok: false, reason: "identical-shift" };

  // After the swap: initiator works `toShift`, counterparty works `fromShift`.
  if (fromOtherShifts.some((s) => shiftsOverlap(s, toShift))) return { ok: false, reason: "double-booking-from" };
  if (toOtherShifts.some((s) => shiftsOverlap(s, fromShift))) return { ok: false, reason: "double-booking-to" };

  return { ok: true };
}
