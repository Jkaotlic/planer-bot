import type { Bot } from "grammy";
import { formatBirthDate } from "@planer/shared";
import type { Db } from "../db/client";
import { notifyUser } from "../bot/notify";
import { recordAudit } from "../repo/audit";
import { getEmployeeById } from "../repo/employees";
import {
  ADMIN_NOTICE_DAYS,
  adminNoticeMessage,
  adminNoticeReadyMessage,
  adminRecipients,
  campaignsScheduledFor,
  ensureCampaign,
  markAdminNotified,
  markScheduleNotified,
  scheduleNoticeMessage,
  upcomingBirthdays,
} from "./birthday-service";

/**
 * The two things the bot does about birthdays on its own, and both talk to the
 * ADMINS only. Never the team — the collection is the admin's to send, after
 * they have made the link and seen what will go out.
 *
 *   1. A week ahead: «у Х день рождения через 7 дней».
 *   2. On the day an admin asked to be reminded: «пора разослать сбор по Х».
 *
 * Each nudges once (`adminNotifiedAt` / `scheduleNotifiedAt`), so a tick that
 * runs every five minutes doesn't turn into a five-minute alarm.
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

    // An admin who already pasted the link doesn't need to be told to create
    // one — that instruction is exactly the defect this branch guards against.
    const text = campaign.collectUrl
      ? adminNoticeReadyMessage(birthday.displayName, birthday.birthDateLabel, birthday.daysUntil)
      : adminNoticeMessage(birthday.displayName, birthday.birthDateLabel, birthday.daysUntil);
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

  for (const campaign of campaignsScheduledFor(db, today)) {
    const employee = getEmployeeById(db, campaign.employeeId);
    if (!employee?.birthDate) continue;

    const admins = adminRecipients(db, campaign.employeeId);
    if (admins.length === 0) continue;

    const text = scheduleNoticeMessage(employee.displayName, formatBirthDate(employee.birthDate), campaign.collectUrl);
    let delivered = 0;
    for (const admin of admins) {
      if (await notifyUser(bot, admin.telegramUserId!, text)) delivered += 1;
    }

    // Marked either way, for the same reason as the notice above: a Telegram
    // outage must not become a nag loop. The date is still on the screen.
    markScheduleNotified(db, campaign.id, new Date());
    recordAudit(db, "birthday_schedule_notice", null, {
      employeeId: campaign.employeeId,
      displayName: employee.displayName,
      scheduledSendOn: campaign.scheduledSendOn,
      delivered,
    });
    sent += delivered;
  }

  return sent;
}
