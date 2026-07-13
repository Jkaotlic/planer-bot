import type { SwapStatus, SwapEvent, Shift } from "./types";
import { shiftsOverlap, shiftInterval } from "./overlap";
import { dayNumber, toMinutes } from "./time";

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
  | "double-booking-to";

export type SwapValidation = { ok: true } | { ok: false; reason: SwapRejectReason };

export interface SwapContext {
  fromShift: Shift;
  toShift: Shift;
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

  const nowAbs = dayNumber(now.date) * 24 * 60 + toMinutes(now.time);
  if (shiftInterval(fromShift).start <= nowAbs) return { ok: false, reason: "from-shift-in-past" };
  if (shiftInterval(toShift).start <= nowAbs) return { ok: false, reason: "to-shift-in-past" };

  // After the swap: initiator works `toShift`, counterparty works `fromShift`.
  if (fromOtherShifts.some((s) => shiftsOverlap(s, toShift))) return { ok: false, reason: "double-booking-from" };
  if (toOtherShifts.some((s) => shiftsOverlap(s, fromShift))) return { ok: false, reason: "double-booking-to" };

  return { ok: true };
}
