import { and, eq, isNull, lte } from "drizzle-orm";
import { autoSendDateFor, daysUntilBirthday, describeDaysUntil, formatBirthDate, isCollectionActive, parseBirthDate, type CollectionKind } from "@planer/shared";
import type { Db } from "../db/client";
import { collections, employees, type Collection } from "../db/schema";
import { listActive } from "../repo/employees";

/**
 * Birthdays, and the collection round that goes with one.
 *
 * The rule that shaped everything here: **the bot never mails the team on its
 * own.** It nudges admins a week ahead, and after that every message is an admin
 * pressing a button.
 *
 * С 31.08.2026 у правила ровно одно исключение — `roundsToAutoSend`: сбор на
 * день рождения уходит команде за три дня до праздника без человека, потому что
 * подарок нужен к дате. Сам модуль от этого не изменился: он по-прежнему только
 * считает и записывает, а рассылает `birthday-notice.ts`.
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
    .values({
      kind: "birthday",
      employeeId,
      year: occurrence.year,
      celebratedOn: occurrence.celebratedOn,
      // Вооружается сразу: «за три дня бот разошлёт» — правило дня рождения, а
      // не отдельная настройка, которую надо не забыть включить. Выключается
      // одной кнопкой в боте и переключателем на карточке.
      autoSendOn: autoSendDateFor(occurrence.celebratedOn, asOf),
    })
    .returning()
    .all()[0]!;
}

/**
 * This year's round for that person — or an unsaved draft of it.
 *
 * A GET must not write, and until now looking at a birthday card created a row
 * as a side effect. Preparing is what creates the round, and preparing means
 * saving something: without a link the collection cannot be sent anyway, so a
 * draft is never a state anybody can act on.
 *
 * `id: 0` marks the draft. Callers must not try to send it — `previewCollection`
 * blocks it on the missing link regardless.
 */
export function birthdayRoundDraft(db: Db, employeeId: number, asOf: string): Collection | null {
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

  return {
    id: 0,
    kind: "birthday",
    employeeId,
    year: occurrence.year,
    celebratedOn: occurrence.celebratedOn,
    title: null,
    eventDate: null,
    deadline: null,
    amountPerPerson: null,
    totalGoal: null,
    collectUrl: null,
    messageText: null,
    closedAt: null,
    adminNotifiedAt: null,
    scheduledSendOn: null,
    scheduleNotifiedAt: null,
    autoSendOn: autoSendDateFor(occurrence.celebratedOn, asOf),
    autoSentAt: null,
    sentAt: null,
    sentCount: 0,
    sendCount: 0,
    createdAt: new Date(0),
  };
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

/**
 * Раунды, которые бот обязан разослать сам прямо сейчас.
 *
 * `lte`, а не `eq`: сервер, лежавший в назначенный день, разошлёт на следующий,
 * — тот же довод, что записан у `roundsScheduledFor`. Праздник, который уже
 * прошёл, отсекается `isCollectionActive`: сбор на вчерашний день рождения —
 * это не сбор, а недоразумение.
 *
 * Только дни рождения. У кастомного сбора нет даты, от которой считать «за три
 * дня», и есть своя «дата напоминания» — правило «бот не пишет команде сам» для
 * них продолжает действовать без изменений.
 */
export function roundsToAutoSend(db: Db, date: string): Collection[] {
  return db
    .select()
    .from(collections)
    .where(and(lte(collections.autoSendOn, date), isNull(collections.autoSentAt)))
    .all()
    .filter((round) => round.kind === "birthday")
    .filter((round) => isCollectionActive(round, date));
}

/** Отмечает, что попытка автоотправки была — удачная или нет. */
export function markAutoSent(db: Db, roundId: number, when: Date): void {
  db.update(collections).set({ autoSentAt: when }).where(eq(collections.id, roundId)).run();
}

/** Отчёт админам после автоотправки. */
export function autoSentMessage(name: string, delivered: number, intended: number): string {
  return `💰 Разослал сбор на ${name} — ${delivered} из ${intended}.`;
}

/**
 * Автоотправка не состоялась. Молчать нельзя: тишина читается как «всё под
 * контролем», а подарка не будет.
 *
 * Причина ставится отдельной строкой и дословно: это текст блокера, который
 * админ уже видел в мини-аппе, и переписывать его здесь значило бы завести
 * второй способ сказать одно и то же.
 */
export function autoSendFailedMessage(name: string, reason: string, daysUntil: number): string {
  return [
    `⚠️ Сбор на ${name} не ушёл. День рождения ${describeDaysUntil(daysUntil)}.`,
    "",
    reason,
    "",
    "Пришли ссылку сюда — разошлю сразу.",
  ].join("\n");
}

/**
 * Горизонт, в котором присланная ссылка ищет свой сбор.
 *
 * Шире, чем нудж за неделю: сбор делают и заранее, а «прислал ссылку — бот
 * промолчал» — худший исход для главного жеста этой фичи.
 */
export const LINK_WINDOW_DAYS = 14;

export interface LinkCandidate {
  employeeId: number;
  displayName: string;
  celebratedOn: string;
  daysUntil: number;
  /** `null`, если раунда ещё нет: он заведётся при привязке. */
  collectionId: number | null;
  hasUrl: boolean;
}

/**
 * Сборы, к которым админ может привязать присланную ссылку.
 *
 * Читает, но не пишет: раунда может не быть, и заводит его привязка, а не
 * просмотр — то же правило, по которому `birthdayRoundDraft` отдаёт черновик с
 * `id: 0`, ничего не сохраняя.
 *
 * Отправитель передаётся в `upcomingBirthdays` как «зритель», и это единственная
 * причина, по которой именинник не может привязать ссылку к сбору на себя.
 */
export function linkCandidates(db: Db, asOf: string, senderEmployeeId: number): LinkCandidate[] {
  return upcomingBirthdays(db, asOf, LINK_WINDOW_DAYS, senderEmployeeId)
    .filter((b) => !b.campaign || (b.campaign.sendCount === 0 && b.campaign.closedAt == null))
    .map((b) => ({
      employeeId: b.employeeId,
      displayName: b.displayName,
      celebratedOn: b.celebratedOn,
      daysUntil: b.daysUntil,
      collectionId: b.campaign?.id ?? null,
      hasUrl: Boolean(b.campaign?.collectUrl),
    }));
}
