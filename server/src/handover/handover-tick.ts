import { handoverActions, shiftStartMs } from "@planer/shared";
import { getEmployeeById } from "../repo/employees";
import { getHandover, listLiveHandovers } from "../repo/handovers";
import { listPendingSickLeavesWithin, markHandoverForced } from "../repo/sick-approvals";
import { daysAsked, extensionOf } from "../sick-approval/sick-approval-service";
import { getShift } from "../repo/shifts";
import { safeErrorMessage } from "../util/safe-error";
import { escalate, expireHandover, fanOut, handoverVoidReason, startHandovers, voidHandover, type HandoverDeps } from "./handover-service";

export interface HandoverTickDeps extends HandoverDeps {
  config: { teamTz: string; publicUrl: string; handoverFanHours: number; handoverEscalateHours: number };
}

const HOUR_MS = 60 * 60 * 1000;

/** The team's calendar date at a moment — not the machine's (CLAUDE.md, «Дата — командная»). */
function teamDateAt(ms: number, teamTz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: teamTz }).format(new Date(ms));
}

/**
 * Spec item 11: a sick leave still waiting for an admin must not leave a shift that
 * starts sooner than the escalation threshold with nobody on it. Only those shifts are
 * handed over; the sick leave itself keeps waiting for its «ОК».
 *
 * Bounded twice: pending rows come through the `shift_pending_approval` index, and
 * only those whose span touches [today, today + threshold]. Safe on every tick —
 * `startHandovers` skips shifts that already have a live hand-over, so the second pass
 * creates nothing, sends nothing and leaves `handover_forced_at` as the first pass set it.
 * For a pending EXTENSION only the new days are unapproved; the approved days already
 * have their own hand-overs (or the admin's earlier «ОК» decided them), so they are not touched.
 */
export async function forceUrgentSickHandovers(deps: HandoverTickDeps, nowMs: number): Promise<number> {
  const { db, config } = deps;
  const startsBefore = nowMs + config.handoverEscalateHours * HOUR_MS;
  let forced = 0;
  for (const sick of listPendingSickLeavesWithin(db, teamDateAt(nowMs, config.teamTz), teamDateAt(startsBefore, config.teamTz))) {
    try {
      const owner = sick.employeeId == null ? undefined : getEmployeeById(db, sick.employeeId);
      // Observers hand nothing over — the same gate as the self-entry route.
      if (!owner || owner.isObserver) continue;
      const onlyDates = extensionOf(sick) ? new Set(daysAsked(sick)) : undefined;
      const made = await startHandovers({ ...deps, now: () => nowMs }, { sickEntry: sick, employeeId: owner.id, startsBefore, onlyDates });
      if (made.length === 0) continue;
      markHandoverForced(db, sick.id, new Date(nowMs));
      // Nobody is in the form to pick an addressee and the shift is close: ask everyone now.
      for (const handover of made) {
        if (handover.status === "offered") await fanOut(deps, handover.id);
      }
      forced += made.length;
    } catch (err) {
      console.error(`forceUrgentSickHandovers: sick leave ${sick.id} skipped:`, safeErrorMessage(err));
    }
  }
  return forced;
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
  // Before the ladder, so a hand-over forced this tick is fanned and escalated by the same pass.
  let touched = await forceUrgentSickHandovers(deps, nowMs);

  for (const row of listLiveHandovers(deps.db)) {
    try {
      // Смена ушла от дающего (удалена, переназначена, больничный сняли) —
      // гасим до лестницы: веер и эскалация про такую смену — ложь.
      const reason = handoverVoidReason(deps.db, row);
      if (reason) {
        await voidHandover(deps, row.id, reason);
        touched += 1;
        continue;
      }
      const shift = getShift(deps.db, row.shiftId!)!;

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
