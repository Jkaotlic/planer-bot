import type { SwapStatus, SwapEvent } from "./types";

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
