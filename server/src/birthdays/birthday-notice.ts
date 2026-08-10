import type { Bot } from "grammy";
import { collectionTitle } from "@planer/shared";
import type { Db } from "../db/client";
import { notifyUser } from "../bot/notify";
import { recordAudit } from "../repo/audit";
import { getEmployeeById } from "../repo/employees";
import { adminRecipients } from "../collections/collection-service";
import {
  ADMIN_NOTICE_DAYS,
  adminNoticeMessage,
  adminNoticeReadyMessage,
  ensureBirthdayRound,
  markAdminNotified,
  markScheduleNotified,
  roundsScheduledFor,
  scheduleNoticeMessage,
  upcomingBirthdays,
} from "./birthday-service";

/**
 * The two things the bot does about collections on its own, and both talk to
 * the ADMINS only. Never the team — a collection is the admin's to send, after
 * they have made the link and seen what will go out.
 *
 *   1. A week ahead of a birthday: «у Х день рождения через 7 дней».
 *   2. On the day an admin asked to be reminded — a birthday round or a custom
 *      collection alike: «пора разослать сбор по Х» / «пора дожать сбор».
 *
 * Each nudges once (`adminNotifiedAt` / `scheduleNotifiedAt`), so a tick that
 * runs every five minutes doesn't turn into a five-minute alarm.
 *
 * Returns how many admin messages went out.
 */
export async function runBirthdayNoticeTick(db: Db, bot: Bot, today: string): Promise<number> {
  let sent = 0;

  for (const birthday of upcomingBirthdays(db, today, ADMIN_NOTICE_DAYS)) {
    const round = ensureBirthdayRound(db, birthday.employeeId, today);
    if (!round || round.adminNotifiedAt || round.sendCount > 0) continue;

    const admins = adminRecipients(db, birthday.employeeId);
    if (admins.length === 0) continue;

    // An admin who already pasted the link doesn't need to be told to create
    // one — that instruction is exactly the defect this branch guards against.
    const text = round.collectUrl
      ? adminNoticeReadyMessage(birthday.displayName, birthday.birthDateLabel, birthday.daysUntil)
      : adminNoticeMessage(birthday.displayName, birthday.birthDateLabel, birthday.daysUntil);
    let delivered = 0;
    for (const admin of admins) {
      if (await notifyUser(bot, admin.telegramUserId!, text)) delivered += 1;
    }

    // Mark it either way: a Telegram outage must not turn into a nag loop, and
    // the birthday is visible on the «Дни рождения» screen regardless.
    markAdminNotified(db, round.id, new Date());
    recordAudit(db, "birthday_admin_notice", null, {
      employeeId: birthday.employeeId,
      displayName: birthday.displayName,
      daysUntil: birthday.daysUntil,
      delivered,
    });
    sent += delivered;
  }

  for (const round of roundsScheduledFor(db, today)) {
    // A general fundraiser has no honouree at all — `employeeId` is null, and
    // `adminRecipients(db, null)` correctly reads as "all reachable admins".
    const personName = round.employeeId != null ? (getEmployeeById(db, round.employeeId)?.displayName ?? null) : null;
    const admins = adminRecipients(db, round.employeeId);
    if (admins.length === 0) continue;

    const title = collectionTitle(round, personName);
    const text = scheduleNoticeMessage(title, round.collectUrl, round.kind);
    let delivered = 0;
    for (const admin of admins) {
      if (await notifyUser(bot, admin.telegramUserId!, text)) delivered += 1;
    }

    // Marked either way: a Telegram outage must not become a nag loop. The date
    // is still on the screen.
    markScheduleNotified(db, round.id, new Date());
    // Event type stays `birthday_schedule_notice` even for a custom collection:
    // renaming it would orphan the journal rows already written in production.
    recordAudit(db, "birthday_schedule_notice", null, {
      employeeId: round.employeeId,
      displayName: personName,
      title,
      scheduledSendOn: round.scheduledSendOn,
      delivered,
    });
    sent += delivered;
  }

  return sent;
}
