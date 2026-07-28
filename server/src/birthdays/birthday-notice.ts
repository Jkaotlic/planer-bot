import type { Bot } from "grammy";
import type { Db } from "../db/client";
import { notifyUser } from "../bot/notify";
import { recordAudit } from "../repo/audit";
import {
  ADMIN_NOTICE_DAYS,
  adminNoticeMessage,
  adminRecipients,
  ensureCampaign,
  markAdminNotified,
  upcomingBirthdays,
} from "./birthday-service";

/**
 * The one thing the bot does about birthdays on its own: a week ahead, it tells
 * the ADMINS. Never the team — the collection is the admin's to send, after they
 * have made the link and seen what will go out.
 *
 * Nudges once per birthday per year (`adminNotifiedAt`), so a tick that runs
 * every five minutes doesn't turn into a five-minute alarm.
 *
 * Returns how many admin messages went out.
 */
export async function runBirthdayNoticeTick(db: Db, bot: Bot, today: string): Promise<number> {
  let sent = 0;

  for (const birthday of upcomingBirthdays(db, today, ADMIN_NOTICE_DAYS)) {
    const campaign = ensureCampaign(db, birthday.employeeId, today);
    if (!campaign || campaign.adminNotifiedAt || campaign.status === "sent") continue;

    const admins = adminRecipients(db, birthday.employeeId);
    if (admins.length === 0) continue;

    const text = adminNoticeMessage(birthday.displayName, birthday.birthDateLabel, birthday.daysUntil);
    let delivered = 0;
    for (const admin of admins) {
      if (await notifyUser(bot, admin.telegramUserId!, text)) delivered += 1;
    }

    // Mark it either way: a Telegram outage must not turn into a nag loop, and
    // the birthday is visible on the «Дни рождения» screen regardless.
    markAdminNotified(db, campaign.id, new Date());
    recordAudit(db, "birthday_admin_notice", null, {
      employeeId: birthday.employeeId,
      displayName: birthday.displayName,
      daysUntil: birthday.daysUntil,
      delivered,
    });
    sent += delivered;
  }

  return sent;
}
