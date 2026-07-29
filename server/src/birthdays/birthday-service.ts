import { and, desc, eq, isNull } from "drizzle-orm";
import { daysUntilBirthday, describeDaysUntil, formatBirthDate, parseBirthDate } from "@planer/shared";
import type { Db } from "../db/client";
import { birthdayCampaigns, employees, type BirthdayCampaign, type Employee } from "../db/schema";
import { listActive } from "../repo/employees";

/**
 * Birthdays, and the round of collecting that goes with one.
 *
 * The rule that shapes everything here: **the bot never mails the team on its
 * own.** It nudges admins a week ahead, and after that every message is an admin
 * pressing a button. So this module computes and records; the only thing it
 * decides by itself is who is eligible to receive what.
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
  campaign: BirthdayCampaign | null;
}

/** How far ahead admins are nudged — a week, as he asked. */
export const ADMIN_NOTICE_DAYS = 7;

/** The year the next occurrence lands in, which is what a campaign is keyed by. */
function occurrenceOf(birthDate: string, asOf: string): { celebratedOn: string; year: number } | null {
  const days = daysUntilBirthday(birthDate, asOf);
  if (days === null) return null;
  const when = new Date(Date.parse(`${asOf}T00:00:00Z`) + days * 86_400_000);
  return { celebratedOn: when.toISOString().slice(0, 10), year: when.getUTCFullYear() };
}

/**
 * Everyone with a birthday on file, nearest first, with the campaign for this
 * time round if one exists. `withinDays` trims it to the near future; without it
 * the whole year comes back, which is what the «Дни рождения» list shows.
 */
export function upcomingBirthdays(db: Db, asOf: string, withinDays?: number): UpcomingBirthday[] {
  const rows = db.select().from(birthdayCampaigns).all();
  const campaignFor = new Map(rows.map((row) => [`${row.employeeId}:${row.year}`, row] as const));

  return listActive(db)
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
        campaign: campaignFor.get(`${employee.id}:${occurrence.year}`) ?? null,
      }];
    })
    .sort((a, b) => a.daysUntil - b.daysUntil || a.displayName.localeCompare(b.displayName, "ru"));
}

/** Finds this round's campaign, creating it the first time it's needed. */
export function ensureCampaign(db: Db, employeeId: number, asOf: string): BirthdayCampaign | null {
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get();
  if (!employee?.birthDate) return null;
  const occurrence = occurrenceOf(employee.birthDate, asOf);
  if (!occurrence) return null;

  const existing = db
    .select()
    .from(birthdayCampaigns)
    .where(and(eq(birthdayCampaigns.employeeId, employeeId), eq(birthdayCampaigns.year, occurrence.year)))
    .get();
  if (existing) return existing;

  return db
    .insert(birthdayCampaigns)
    .values({ employeeId, year: occurrence.year, celebratedOn: occurrence.celebratedOn })
    .returning()
    .all()[0]!;
}

/**
 * Who gets the team message: everybody active who can actually be reached on
 * Telegram, minus the person whose birthday it is. Excluding them is the point —
 * a collection is a surprise.
 */
export function teamRecipients(db: Db, birthdayEmployeeId: number): Employee[] {
  return listActive(db).filter(
    (employee) => employee.id !== birthdayEmployeeId && employee.telegramUserId != null,
  );
}

/**
 * Who gets the week-ahead nudge: admins who can be reached — minus the birthday
 * person, even when they are an admin themselves.
 */
export function adminRecipients(db: Db, birthdayEmployeeId: number): Employee[] {
  return teamRecipients(db, birthdayEmployeeId).filter((employee) => employee.isAdmin);
}

/**
 * The wording the team gets when the admin hasn't written their own.
 *
 * Phrased so the name stays in the nominative. We store one display name and
 * nothing that would let us decline it, and «день рождения у Игорь Петров» is
 * exactly the sort of thing that gets noticed when it lands in 25 chats at once.
 */
export function defaultMessage(name: string, birthDateLabel: string, collectUrl: string | null): string {
  const lines = [`🎂 ${name} празднует день рождения ${birthDateLabel}.`];
  if (collectUrl) lines.push("", `Сбор на подарок: ${collectUrl}`);
  return lines.join("\n");
}

/** The nudge admins get a week ahead. Same nominative rule as `defaultMessage`. */
export function adminNoticeMessage(name: string, birthDateLabel: string, daysUntil: number): string {
  return [
    // «через 7 дней» / «завтра» / «сегодня» — the same wording both screens show.
    `🎂 ${name} празднует день рождения ${describeDaysUntil(daysUntil)} — ${birthDateLabel}.`,
    "",
    "Создай сбор в Сбербанк Онлайн и вставь ссылку в разделе «Дни рождения»,",
    "а потом сам решишь, когда разослать команде.",
  ].join("\n");
}

export interface CampaignPreview {
  employeeId: number;
  displayName: string;
  celebratedOn: string;
  collectUrl: string | null;
  /** Exactly the text that will be sent, defaults filled in. */
  message: string;
  recipients: { employeeId: number; displayName: string }[];
  /** Why sending is blocked, or null when it isn't. */
  blocker: string | null;
  alreadySentAt: Date | null;
}

/**
 * What would be sent, to whom, right now. The admin sees this before anything
 * leaves — the whole point of the flow is that nothing is a surprise to them.
 */
export function previewCampaign(db: Db, employeeId: number, asOf: string): CampaignPreview | null {
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get();
  if (!employee?.birthDate) return null;
  const campaign = ensureCampaign(db, employeeId, asOf);
  if (!campaign) return null;

  const recipients = teamRecipients(db, employeeId);
  const label = formatBirthDate(employee.birthDate);
  const message = campaign.messageText?.trim()
    || defaultMessage(employee.displayName, label, campaign.collectUrl);

  let blocker: string | null = null;
  if (campaign.status === "sent") blocker = "Уже разослано — повторная отправка отключена.";
  else if (!campaign.collectUrl) blocker = "Нет ссылки на сбор — вставь её, прежде чем рассылать.";
  else if (recipients.length === 0) blocker = "Некому отправлять: ни у кого из команды не привязан Telegram.";

  return {
    employeeId,
    displayName: employee.displayName,
    celebratedOn: campaign.celebratedOn,
    collectUrl: campaign.collectUrl,
    message,
    recipients: recipients.map((r) => ({ employeeId: r.id, displayName: r.displayName })),
    blocker,
    alreadySentAt: campaign.sentAt,
  };
}

/** Saves the link, the wording and/or the reminder date. A link moves the round to «готово к отправке». */
export function updateCampaign(
  db: Db,
  employeeId: number,
  asOf: string,
  patch: { collectUrl?: string | null; messageText?: string | null; scheduledSendOn?: string | null },
): BirthdayCampaign | null {
  const campaign = ensureCampaign(db, employeeId, asOf);
  if (!campaign) return null;
  if (campaign.status === "sent") return campaign; // settled; nothing left to edit

  const collectUrl = patch.collectUrl !== undefined ? patch.collectUrl : campaign.collectUrl;
  const messageText = patch.messageText !== undefined ? patch.messageText : campaign.messageText;
  const scheduledSendOn = patch.scheduledSendOn !== undefined ? patch.scheduledSendOn : campaign.scheduledSendOn;
  // Moving the date re-arms the reminder: an admin who pushes it back a day means
  // to be told on the new day, not to be told nothing because the old one fired.
  const scheduleNotifiedAt = scheduledSendOn === campaign.scheduledSendOn ? campaign.scheduleNotifiedAt : null;

  return db
    .update(birthdayCampaigns)
    .set({ collectUrl, messageText, scheduledSendOn, scheduleNotifiedAt, status: collectUrl ? "ready" : "pending" })
    .where(eq(birthdayCampaigns.id, campaign.id))
    .returning()
    .all()[0]!;
}

/** Records that this round went out — called only after the messages were sent. */
export function markSent(db: Db, campaignId: number, sentCount: number, when: Date): void {
  db.update(birthdayCampaigns)
    .set({ status: "sent", sentAt: when, sentCount })
    .where(eq(birthdayCampaigns.id, campaignId))
    .run();
}

/** Records that admins have been nudged for this round, so they are nudged once. */
export function markAdminNotified(db: Db, campaignId: number, when: Date): void {
  db.update(birthdayCampaigns)
    .set({ adminNotifiedAt: when })
    .where(eq(birthdayCampaigns.id, campaignId))
    .run();
}

/**
 * Rounds whose reminder day is today and which have not been reminded about.
 * A round already sent is skipped: there is nothing left to remind anyone of.
 */
export function campaignsScheduledFor(db: Db, date: string): BirthdayCampaign[] {
  return db
    .select()
    .from(birthdayCampaigns)
    .where(and(eq(birthdayCampaigns.scheduledSendOn, date), isNull(birthdayCampaigns.scheduleNotifiedAt)))
    .all()
    .filter((campaign) => campaign.status !== "sent");
}

/** Records that the scheduled reminder went out, so it goes out once. */
export function markScheduleNotified(db: Db, campaignId: number, when: Date): void {
  db.update(birthdayCampaigns)
    .set({ scheduleNotifiedAt: when })
    .where(eq(birthdayCampaigns.id, campaignId))
    .run();
}

/**
 * The reminder an admin asked for. Same nominative rule as `defaultMessage` —
 * we store one display name and nothing that would let us decline it.
 */
export function scheduleNoticeMessage(name: string, birthDateLabel: string, collectUrl: string | null): string {
  const lines = [`⏰ Пора разослать сбор — ${name}, день рождения ${birthDateLabel}.`];
  if (collectUrl) lines.push("", `Ссылка: ${collectUrl}`);
  lines.push("", "Открой «Дни рождения» в мини-приложении и нажми «Разослать».");
  return lines.join("\n");
}

export interface CampaignListRow {
  campaign: BirthdayCampaign;
  displayName: string;
  /** "5 августа", or "" for somebody whose birthday was cleared after the fact. */
  birthDateLabel: string;
}

/**
 * Every round ever prepared, newest first.
 *
 * `upcomingBirthdays` cannot answer this: it keys campaigns by the NEXT
 * occurrence of a birthday, so the moment a birthday passes its campaign drops
 * out of that list entirely — which is precisely the one an admin wants to look
 * back at. Hence a separate read.
 *
 * Bounded because this table grows by one row per person per year and the screen
 * scrolls; a hundred is several years of a team this size.
 */
export function listAllCampaigns(db: Db, limit = 100): CampaignListRow[] {
  const people = new Map(db.select().from(employees).all().map((employee) => [employee.id, employee] as const));
  return db
    .select()
    .from(birthdayCampaigns)
    .orderBy(desc(birthdayCampaigns.celebratedOn))
    .limit(limit)
    .all()
    .flatMap((campaign) => {
      const employee = people.get(campaign.employeeId);
      if (!employee) return [];
      return [{
        campaign,
        displayName: employee.displayName,
        birthDateLabel: employee.birthDate ? formatBirthDate(employee.birthDate) : "",
      }];
    });
}
