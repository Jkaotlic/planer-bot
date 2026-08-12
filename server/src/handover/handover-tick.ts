import { handoverActions, shiftStartMs } from "@planer/shared";
import { getHandover, listLiveHandovers } from "../repo/handovers";
import { getShift } from "../repo/shifts";
import { safeErrorMessage } from "../util/safe-error";
import { escalate, expireHandover, fanOut, type HandoverDeps } from "./handover-service";

export interface HandoverTickDeps extends HandoverDeps {
  config: { teamTz: string; handoverFanHours: number; handoverEscalateHours: number };
}

/**
 * One pass of the ladder over every live handover.
 *
 * The rule itself lives in `@planer/shared` and knows nothing about the database:
 * this function only reads rows, asks it what to do, and does it. Keeping the
 * decision pure is what makes «2:59 — молчание, 3:01 — веер» testable without a
 * clock anywhere near it.
 *
 * One handover going wrong must not silence the rest — the same lesson the
 * reminder tick learned the hard way, when a deleted shift threw mid-loop and
 * everybody further down the list got nothing that evening.
 *
 * Returns how many handovers were acted on, for the caller's log line.
 */
export async function runHandoverTick(deps: HandoverTickDeps, nowMs: number): Promise<number> {
  let touched = 0;

  for (const row of listLiveHandovers(deps.db)) {
    try {
      const shift = row.shiftId == null ? undefined : getShift(deps.db, row.shiftId);
      if (!shift) {
        // The entry was deleted by an admin. There is nothing left to hand over,
        // and a row pointing at nothing would be retried on every tick forever.
        expireHandover(deps, row.id);
        touched += 1;
        continue;
      }

      const actions = handoverActions(
        {
          status: row.status,
          offeredAt: row.offeredAt.getTime(),
          escalatedAt: row.escalatedAt?.getTime() ?? null,
          shiftStartsAt: shiftStartMs(shift, deps.config.teamTz),
        },
        nowMs,
        { fanAfterHours: deps.config.handoverFanHours, escalateBeforeHours: deps.config.handoverEscalateHours },
      );
      if (actions.length === 0) continue;

      for (const action of actions) {
        // Re-read between actions: a fan-out can be answered by somebody while
        // this loop is still awaiting Telegram, and escalating a shift that has
        // just found an owner would tell the admins about a problem that no
        // longer exists.
        const current = getHandover(deps.db, row.id);
        if (!current || (current.status !== "offered" && current.status !== "fanned")) break;
        if (action === "fan") await fanOut(deps, row.id);
        if (action === "escalate") await escalate(deps, row.id);
        if (action === "expire") expireHandover(deps, row.id);
      }
      touched += 1;
    } catch (err) {
      console.error(`runHandoverTick: handover ${row.id} skipped:`, safeErrorMessage(err));
    }
  }

  return touched;
}
