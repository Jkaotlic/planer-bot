import type { Bot } from "grammy";
import type { Db } from "../db/client";
import { getEmployeeById } from "../repo/employees";
import { notifyAdmins, notifyHandoverFan, notifyHandoverOffer, notifyUser } from "../bot/notify";
import type { HandoverMessenger } from "./handover-service";

/**
 * The real messenger: the handover service's letters, actually sent.
 *
 * Split from the service so the service can be tested on WHO was written to
 * rather than on whether grammy was called. `bot` may be null — the server
 * starts fine with a bad token, and a feature that throws in that state would
 * take the HTTP side down with it.
 *
 * A person with no Telegram is skipped silently: a third of the roster has never
 * linked an account, and that is a known state of this system, not a failure.
 */
export function createHandoverMessenger(bot: Bot | null, db: Db): HandoverMessenger {
  const telegramIdOf = (employeeId: number): number | null => getEmployeeById(db, employeeId)?.telegramUserId ?? null;

  return {
    async offer(employeeId, handoverId, text) {
      const chat = telegramIdOf(employeeId);
      if (bot && chat != null) await notifyHandoverOffer(bot, chat, handoverId, text);
    },
    async fan(employeeIds, handoverId, text) {
      if (bot) await notifyHandoverFan(bot, db, handoverId, employeeIds, text);
    },
    async plain(employeeId, text) {
      const chat = telegramIdOf(employeeId);
      if (bot && chat != null) await notifyUser(bot, chat, text);
    },
    async admins(text) {
      if (bot) await notifyAdmins(bot, db, text);
    },
  };
}
