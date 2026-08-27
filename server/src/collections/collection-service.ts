import { eq, sql } from "drizzle-orm";
import {
  outgoingCollectionMessage,
  collectionStatus,
  collectionTitle,
  compareCollections,
  isCollectionActive,
  paymentProgress,
  type CollectionKind,
  type CollectionStatus,
} from "@planer/shared";
import type { Db } from "../db/client";
import { collections, type Collection, type Employee } from "../db/schema";
import { getEmployeeById, listActive } from "../repo/employees";
import { isNoticeMuted } from "../repo/notice-prefs";
import { marksOfMany, removeMarksOf } from "./payment-repo";

/**
 * A collection of money — the birthday kind and the hand-made kind, on one code
 * path. What differs between them is data, not behaviour: a birthday round has
 * a person and a year, a custom one has a subject and an optional honouree.
 *
 * The rule that shapes this module, same as it shaped the birthday feature:
 * **the bot never mails the team on its own.** Everything here computes and
 * records; sending is an admin pressing a button after seeing the preview.
 */

/** A collection with everything a screen needs spelled out. */
export interface CollectionView {
  collection: Collection;
  /** The honouree's name, or null for a general collection. */
  personName: string | null;
  title: string;
  status: CollectionStatus;
  active: boolean;
}

export interface CollectionPreview {
  id: number;
  kind: CollectionKind;
  title: string;
  personName: string | null;
  employeeId: number | null;
  collectUrl: string | null;
  /** Exactly the text that will be sent, defaults filled in. */
  message: string;
  recipients: { employeeId: number; displayName: string }[];
  /** Why sending is blocked, or null when it isn't. */
  blocker: string | null;
  sendCount: number;
  lastSentAt: Date | null;
}

export interface NewCustomCollection {
  title: string;
  employeeId: number | null;
  eventDate: string | null;
  deadline: string | null;
  amountPerPerson: number | null;
  totalGoal: number | null;
  collectUrl: string | null;
  messageText: string | null;
  scheduledSendOn: string | null;
}

/** Every field an admin may edit. Absent key means «leave as is». */
export interface CollectionPatch {
  title?: string;
  employeeId?: number | null;
  eventDate?: string | null;
  deadline?: string | null;
  amountPerPerson?: number | null;
  totalGoal?: number | null;
  collectUrl?: string | null;
  messageText?: string | null;
  scheduledSendOn?: string | null;
}

export type UpdateResult = { ok: true; collection: Collection } | { ok: false; error: string };

export function getCollection(db: Db, id: number): Collection | null {
  return db.select().from(collections).where(eq(collections.id, id)).get() ?? null;
}

/** The honouree's name, or null — for a general collection or a deleted person. */
function personNameOf(db: Db, collection: Collection): string | null {
  if (collection.employeeId == null) return null;
  return getEmployeeById(db, collection.employeeId)?.displayName ?? null;
}

/**
 * Every collection, in the order both consoles show them.
 *
 * `viewerEmployeeId` is not optional: a collection is a surprise, and the one
 * person who must never see it is its honouree — including when they are the
 * admin looking at the screen.
 */
export function listCollections(db: Db, today: string, viewerEmployeeId: number): CollectionView[] {
  return db
    .select()
    .from(collections)
    .all()
    .filter((collection) => collection.employeeId !== viewerEmployeeId)
    .map((collection) => {
      const personName = personNameOf(db, collection);
      return {
        collection,
        personName,
        title: collectionTitle(collection, personName),
        status: collectionStatus(collection),
        active: isCollectionActive(collection, today),
      };
    })
    .sort((a, b) =>
      compareCollections(
        { ...a.collection, createdAt: a.collection.createdAt.toISOString() },
        { ...b.collection, createdAt: b.collection.createdAt.toISOString() },
        today,
      ),
    );
}

export function createCustomCollection(db: Db, input: NewCustomCollection): Collection {
  return db.insert(collections).values({ kind: "custom", ...input }).returning().all()[0]!;
}

/**
 * Saves an edit.
 *
 * After the first send the subject is frozen: the team has already been told
 * what this collection is and who it is for, and changing that after the fact
 * is not an edit but a different message. Everything else stays editable —
 * links get regenerated and weddings get moved.
 */
export function updateCollection(db: Db, id: number, patch: CollectionPatch): UpdateResult {
  const current = getCollection(db, id);
  if (!current) return { ok: false, error: "not_found" };

  const subjectTouched =
    (patch.title !== undefined && patch.title !== current.title) ||
    (patch.employeeId !== undefined && patch.employeeId !== current.employeeId);
  if (current.sendCount > 0 && subjectTouched) {
    return { ok: false, error: "Сбор уже разослан — повод и виновника менять нельзя." };
  }

  // Moving the reminder day re-arms it: an admin who pushes it back means to be
  // told on the new day, not to be told nothing because the old one fired.
  const scheduleNotifiedAt =
    patch.scheduledSendOn !== undefined && patch.scheduledSendOn !== current.scheduledSendOn
      ? null
      : current.scheduleNotifiedAt;

  const collection = db
    .update(collections)
    .set({ ...patch, scheduleNotifiedAt })
    .where(eq(collections.id, id))
    .returning()
    .all()[0]!;
  return { ok: true, collection };
}

/** «Собрали, закрыть» — and back, because an unrecoverable tap is worth nothing. */
export function setCollectionClosed(db: Db, id: number, closed: boolean, when: Date): Collection | null {
  if (!getCollection(db, id)) return null;
  return db
    .update(collections)
    .set({ closedAt: closed ? when : null })
    .where(eq(collections.id, id))
    .returning()
    .all()[0]!;
}

/**
 * Deletes a collection nobody has heard of yet.
 *
 * Once it has been sent there is nothing to delete: people already got the
 * message, and the journal row about it must keep making sense. A birthday
 * round is refused outright, sent or not — it is derived from the roster's
 * birth dates, not admin-authored, so deleting it would just have the next
 * pass recreate the same row.
 */
export function deleteCollection(db: Db, id: number): { ok: true } | { ok: false; error: string } {
  const current = getCollection(db, id);
  if (!current) return { ok: false, error: "not_found" };
  if (current.kind === "birthday") return { ok: false, error: "Сбор на день рождения не удаляется." };
  if (current.sendCount > 0) return { ok: false, error: "Сбор уже разослан — удалить нельзя." };
  // Осиротевшая отметка — это строка со ссылкой в пустоту, то есть сломанный
  // внешний ключ. Через `payment-repo`, а не через `payment-service`: сервис
  // импортирует отсюда `recipientsOf`, и обратный импорт замкнул бы круг.
  removeMarksOf(db, id);
  db.delete(collections).where(eq(collections.id, id)).run();
  return { ok: true };
}

/**
 * Who gets the message: everybody active the bot can actually reach, minus the
 * honouree. Excluding them is the point — a collection is a surprise.
 */
export function recipientsOf(db: Db, honoureeId: number | null): Employee[] {
  return listActive(db).filter(
    (employee) => employee.id !== honoureeId && employee.telegramUserId != null,
  );
}

/** Кому уходит админский нудж: достижимые админы, минус виновник торжества,
 *  минус выключившие себе этот вид.
 *
 *  Проверка здесь, а не в двух циклах `birthday-notice`, потому что эта функция
 *  и есть «кому писать про сборы»: у неё ровно два вызывающих, и оба про это.
 *  Сама рассылка сбора команде идёт через `recipientsOf` и никаких выключателей
 *  не знает — от объявления о сборе не отписываются. */
export function adminRecipients(db: Db, honoureeId: number | null): Employee[] {
  return recipientsOf(db, honoureeId).filter(
    (employee) => employee.isAdmin && !isNoticeMuted(db, employee.id, "celebrations"),
  );
}

/**
 * What would be sent, to whom, right now. The admin sees this before anything
 * leaves — the whole point of the flow is that nothing surprises them.
 */
export function previewCollection(db: Db, collection: Collection): CollectionPreview {
  const personName = personNameOf(db, collection);
  const recipients = recipientsOf(db, collection.employeeId);
  const honouree = collection.employeeId != null ? getEmployeeById(db, collection.employeeId) : null;

  const message = outgoingCollectionMessage(
    {
      kind: collection.kind,
      title: collection.title,
      personName,
      birthDateLabel: honouree?.birthDate ?? null,
      eventDate: collection.eventDate,
      deadline: collection.deadline,
      amountPerPerson: collection.amountPerPerson,
      totalGoal: collection.totalGoal,
      collectUrl: collection.collectUrl,
    },
    collection.sendCount > 0 ? "reminder" : "first",
    collection.messageText,
  );

  let blocker: string | null = null;
  if (collection.closedAt) blocker = "Сбор закрыт — рассылать нечего.";
  else if (collection.kind === "birthday" && collection.sendCount > 0) {
    blocker = "Уже разослано — повторная отправка отключена.";
  } else if (!collection.collectUrl) blocker = "Нет ссылки на сбор — вставь её, прежде чем рассылать.";
  else if (recipients.length === 0) blocker = "Некому отправлять: ни у кого из команды не привязан Telegram.";

  return {
    id: collection.id,
    kind: collection.kind,
    title: collectionTitle(collection, personName),
    personName,
    employeeId: collection.employeeId,
    collectUrl: collection.collectUrl,
    message,
    recipients: recipients.map((r) => ({ employeeId: r.id, displayName: r.displayName })),
    blocker,
    sendCount: collection.sendCount,
    lastSentAt: collection.sentAt,
  };
}

/** Records that a round went out — called only after the messages were sent. */
export function markCollectionSent(db: Db, id: number, delivered: number, when: Date): void {
  db.update(collections)
    .set({ sentAt: when, sentCount: delivered, sendCount: sql`${collections.sendCount} + 1` })
    .where(eq(collections.id, id))
    .run();
}

/** A collection as a worker sees it: what it is for, how much, and the link. */
export interface WorkerCollection {
  id: number;
  title: string;
  personName: string | null;
  collectUrl: string | null;
  amountPerPerson: number | null;
  totalGoal: number | null;
  deadline: string | null;
  eventDate: string | null;
  /** Своя галочка: «я перевёл». */
  paid: boolean;
  /** Сколько человек уже отметилось и сколько всего просили — «7 из 12». */
  paidCount: number;
  recipientCount: number;
}

/**
 * What this person should see in the Mini App: a link to a collection that is
 * running right now, because a link posted once in a private chat sinks out of
 * view in a couple of days while the collection itself runs for a week.
 *
 * Three conditions, each of them load-bearing: it must have actually been sent
 * (before that it is the admin's draft, and showing it would leak the surprise
 * before anyone decided to reveal it), it must still be running (a finished
 * collection is history, not a call to chip in), and it must not be about them
 * (`listCollections` already enforces this — the one rule that governs the
 * whole feature: the honouree never sees their own collection).
 */
export function collectionsForWorker(db: Db, today: string, employeeId: number): WorkerCollection[] {
  const rows = listCollections(db, today, employeeId).filter(
    (row) => row.collection.sendCount > 0 && row.active,
  );
  // Отметки всех показанных сборов — одним запросом, а не по запросу на карточку.
  const marks = marksOfMany(db, rows.map((row) => row.collection.id));

  return rows.map((row) => {
    const mine = marks.filter((mark) => mark.collectionId === row.collection.id);
    const progress = paymentProgress(
      recipientsOf(db, row.collection.employeeId).map((e) => ({
        employeeId: e.id,
        displayName: e.displayName,
      })),
      mine,
    );
    return {
      id: row.collection.id,
      title: row.title,
      personName: row.personName,
      collectUrl: row.collection.collectUrl,
      amountPerPerson: row.collection.amountPerPerson,
      totalGoal: row.collection.totalGoal,
      deadline: row.collection.deadline,
      eventDate: row.collection.eventDate,
      paid: mine.some((mark) => mark.employeeId === employeeId),
      paidCount: progress.paidCount,
      recipientCount: progress.total,
    };
  });
}
