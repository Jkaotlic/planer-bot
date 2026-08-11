import type { Bot } from "grammy";

import type { Db } from "../db/client";
import type { Shift } from "../db/schema";
import { getEmployeeById } from "../repo/employees";
import { type NotifyReach, notifyScheduleChange } from "./change-notice";
import { type EmployeeDiff, diffSchedules } from "./schedule-diff";

/**
 * Twenty seconds, measured against the incident this exists for: an admin
 * cancelled one worker's holiday and typed a work week over it with 4-11
 * seconds between clicks, and the worker got five separate messages in 24
 * seconds. A pause longer than this window honestly earns a second letter.
 */
export const NOTICE_WINDOW_MS = 20_000;

interface Pending {
  diff: EmployeeDiff;
  actorEmployeeId: number;
  now: { date: string; time: string };
  timer: ReturnType<typeof setTimeout>;
}

export interface NoticeBufferDeps {
  db: Db;
  bot: Bot | undefined;
  windowMs?: number;
}

export interface RegisterOpts {
  actorEmployeeId: number;
  before: Shift | null;
  after: Shift | null;
  now: { date: string; time: string };
}

export interface NoticeBuffer {
  register(opts: RegisterOpts): NotifyReach;
  flushNow(): Promise<void>;
}

/**
 * Collects hand edits per worker and sends one letter instead of one per entry.
 *
 * In memory on purpose, the same call `rate-limit.ts` makes: one process, one
 * database, no second replica. The cost is named in the spec — an edit made in
 * the last twenty seconds before a restart never reaches its worker.
 *
 * Known limit, deliberately not solved: creating an entry and deleting it again
 * inside one window reports «+1, −1» rather than staying silent. Cancelling out
 * would mean comparing entries instead of events, and the case is rare.
 */
export function createNoticeBuffer(deps: NoticeBufferDeps): NoticeBuffer {
  const { db, bot } = deps;
  const windowMs = deps.windowMs ?? NOTICE_WINDOW_MS;
  const pending = new Map<number, Pending>();

  async function flush(employeeId: number): Promise<void> {
    const held = pending.get(employeeId);
    if (!held) return;
    pending.delete(employeeId);
    clearTimeout(held.timer);
    await notifyScheduleChange(db, bot, {
      actorEmployeeId: held.actorEmployeeId,
      diffs: new Map([[employeeId, held.diff]]),
      cause: "manual",
      now: held.now,
    });
  }

  function register(opts: RegisterOpts): NotifyReach {
    const perEmployee = diffSchedules(
      opts.before ? [opts.before] : [],
      opts.after ? [opts.after] : [],
    );
    let intended = 0;
    let delivered = 0;

    for (const [employeeId, incoming] of perEmployee) {
      // Skipped before counting: an admin editing their own shift must not be
      // told «уйдёт 0 из 1» about a letter that is never written.
      if (employeeId === opts.actorEmployeeId) continue;

      // The prediction the route answers with. What it cannot know yet is
      // whether Telegram will accept the message — only whether there is an
      // account to send it to.
      intended += 1;
      if (getEmployeeById(db, employeeId)?.telegramUserId != null) delivered += 1;

      const held = pending.get(employeeId);
      if (held) clearTimeout(held.timer);
      const diff: EmployeeDiff = held
        ? {
            added: [...held.diff.added, ...incoming.added],
            removed: [...held.diff.removed, ...incoming.removed],
            changed: [...held.diff.changed, ...incoming.changed],
          }
        : incoming;

      pending.set(employeeId, {
        diff,
        actorEmployeeId: opts.actorEmployeeId,
        now: opts.now,
        // A later edit for the same worker restarts the wait: the letter should
        // describe the state the admin stopped at, not one they passed through.
        timer: setTimeout(() => void flush(employeeId), windowMs),
      });
    }
    return { delivered, intended };
  }

  /** Sends everything held right now. For tests and for a graceful shutdown. */
  async function flushNow(): Promise<void> {
    for (const employeeId of [...pending.keys()]) await flush(employeeId);
  }

  return { register, flushNow };
}
