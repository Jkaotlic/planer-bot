import { and, eq, isNull, lte } from "drizzle-orm";
import { daysUntilBirthday, describeDaysUntil, formatBirthDate, parseBirthDate, type CollectionKind } from "@planer/shared";
import type { Db } from "../db/client";
import { collections, employees, type Collection } from "../db/schema";
import { listActive } from "../repo/employees";

/**
 * Birthdays, and the collection round that goes with one.
 *
 * The rule that shapes everything here: **the bot never mails the team on its
 * own.** It nudges admins a week ahead, and after that every message is an admin
 * pressing a button. So this module computes and records; the only thing it
 * decides by itself is who is eligible to receive what.
 *
 * The round itself — reading, editing, sending, previewing — is owned by
 * `../collections/collection-service`, on the same `collections` table a custom
 * fundraiser lives on. This file keeps only the birthday-specific question:
 * WHEN does a round exist, and WHAT does the bot tell admins about it.
 */

export interface UpcomingBirthday {
  employeeId: number;
  displayName: string;
  /** "MM-DD" as stored. */
  birthDate: string;
  /** "5 августа". */
  birthDateLabel: string;
  /** The date it falls on this time round, YYYY-MM-DD. */
  celebratedOn: string;
  daysUntil: number;
  campaign: Collection | null;
}

/** How far ahead admins are nudged — a week, as he asked. */
export const ADMIN_NOTICE_DAYS = 7;

/** The year the next occurrence lands in, which is what a round is keyed by. */
function occurrenceOf(birthDate: string, asOf: string): { celebratedOn: string; year: number } | null {
  const days = daysUntilBirthday(birthDate, asOf);
  if (days === null) return null;
  const when = new Date(Date.parse(`${asOf}T00:00:00Z`) + days * 86_400_000);
  return { celebratedOn: when.toISOString().slice(0, 10), year: when.getUTCFullYear() };
}

/**
 * Everyone with a birthday on file, nearest first, with the round for this
 * time round if one exists. `withinDays` trims it to the near future; without
 * it the whole year comes back, which is what the «Дни рождения» list shows.
 */
export function upcomingBirthdays(
  db: Db,
  asOf: string,
  withinDays?: number,
  viewerEmployeeId?: number,
): UpcomingBirthday[] {
  const rows = db.select().from(collections).where(eq(collections.kind, "birthday")).all();
  const roundFor = new Map(rows.map((row) => [`${row.employeeId}:${row.year}`, row] as const));

  return listActive(db)
    // A collection is a surprise, and the one person who must never see it is
    // the honouree — including when they are the admin looking at the screen.
    // Left undefined by the notice tick on purpose: the bot messages everyone
    // on this list, honouree included, or their colleagues never get reminded.
    .filter((employee) => employee.id !== viewerEmployeeId)
    .filter((employee) => employee.birthDate && parseBirthDate(employee.birthDate))
    .flatMap((employee) => {
      const occurrence = occurrenceOf(employee.birthDate!, asOf);
      const daysUntil = daysUntilBirthday(employee.birthDate!, asOf);
      if (!occurrence || daysUntil === null) return [];
      if (withinDays !== undefined && daysUntil > withinDays) return [];
      return [{
        employeeId: employee.id,
        displayName: employee.displayName,
        birthDate: employee.birthDate!,
        birthDateLabel: formatBirthDate(employee.birthDate!),
        celebratedOn: occurrence.celebratedOn,
        daysUntil,
        campaign: roundFor.get(`${employee.id}:${occurrence.year}`) ?? null,
      }];
    })
    .sort((a, b) => a.daysUntil - b.daysUntil || a.displayName.localeCompare(b.displayName, "ru"));
}

/** Finds this year's birthday round, creating it the first time it's needed. */
export function ensureBirthdayRound(db: Db, employeeId: number, asOf: string): Collection | null {
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get();
  if (!employee?.birthDate) return null;
  const occurrence = occurrenceOf(employee.birthDate, asOf);
  if (!occurrence) return null;

  const existing = db
    .select()
    .from(collections)
    .where(and(
      eq(collections.kind, "birthday"),
      eq(collections.employeeId, employeeId),
      eq(collections.year, occurrence.year),
    ))
    .get();
  if (existing) return existing;

  return db
    .insert(collections)
    .values({ kind: "birthday", employeeId, year: occurrence.year, celebratedOn: occurrence.celebratedOn })
    .returning()
    .all()[0]!;
}

/** The nudge admins get a week ahead. Same nominative rule as everywhere else. */
export function adminNoticeMessage(name: string, birthDateLabel: string, daysUntil: number): string {
  return [
    // «через 7 дней» / «завтра» / «сегодня» — the same wording both screens show.
    `🎂 ${name} празднует день рождения ${describeDaysUntil(daysUntil)} — ${birthDateLabel}.`,
    "",
    "Создай сбор в Сбербанк Онлайн и вставь ссылку в разделе «Дни рождения»,",
    "а потом сам решишь, когда разослать команде.",
  ].join("\n");
}

/**
 * The week-ahead nudge when an admin already pasted the link before this pass
 * ever ran — preparing early became the normal case once the reminder-date
 * feature landed. Telling them to create a collection they already made would
 * be exactly the noise this message exists to avoid, so it only carries the
 * heads-up and drops the instructions to create the link.
 */
export function adminNoticeReadyMessage(name: string, birthDateLabel: string, daysUntil: number): string {
  return [
    `🎂 ${name} празднует день рождения ${describeDaysUntil(daysUntil)} — ${birthDateLabel}.`,
    "",
    "Сбор уже готов — открой «Дни рождения» и разошли его команде, когда будет время.",
  ].join("\n");
}

/** Records that admins have been nudged for this round, so they are nudged once. */
export function markAdminNotified(db: Db, roundId: number, when: Date): void {
  db.update(collections)
    .set({ adminNotifiedAt: when })
    .where(eq(collections.id, roundId))
    .run();
}

/**
 * Rounds whose reminder day is today — or earlier and missed — and which have
 * not been reminded about. Both kinds: «напомнить мне» is a custom collection's
 * feature too, and a tick that skipped them would silently drop the reminder.
 *
 * Unlike the 7-day window of `upcomingBirthdays`, which heals itself after any
 * outage, a scheduled reminder is a single day: `eq(scheduledSendOn, date)`
 * would never match again if the server was down that day. So anything in the
 * past is picked up too — bounded by the collection's own edge, because
 * reminding about a collection that is over is noise, not a service.
 *
 * A birthday round that already went out is skipped: it cannot be sent twice,
 * so there is nothing left to remind anyone of. A custom one is kept — there
 * the reminder means «пора дожать».
 */
export function roundsScheduledFor(db: Db, date: string): Collection[] {
  return db
    .select()
    .from(collections)
    .where(and(lte(collections.scheduledSendOn, date), isNull(collections.scheduleNotifiedAt)))
    .all()
    .filter((round) => {
      // `sendCount` replaces the old `status !== 'sent'`: the count is now the
      // only truth about whether anything reached the team.
      if (round.kind === "birthday" && round.sendCount > 0) return false;
      const edge = round.celebratedOn ?? round.deadline ?? round.eventDate;
      return edge == null || edge >= date;
    });
}

/** Records that the scheduled reminder went out, so it goes out once. */
export function markScheduleNotified(db: Db, roundId: number, when: Date): void {
  db.update(collections)
    .set({ scheduleNotifiedAt: when })
    .where(eq(collections.id, roundId))
    .run();
}

/**
 * The reminder an admin asked for. Same nominative rule as everywhere else: we
 * store one display name and nothing that would let us decline it.
 */
export function scheduleNoticeMessage(title: string, collectUrl: string | null, kind: CollectionKind): string {
  const lines = [`⏰ Пора разослать сбор — ${title}.`];
  if (collectUrl) lines.push("", `Ссылка: ${collectUrl}`);
  lines.push("", `Открой «Сборы» в мини-приложении и нажми «${kind === "birthday" ? "Разослать" : "Напомнить"}».`);
  return lines.join("\n");
}
