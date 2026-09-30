import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { RECIPIENT_GROUPS_MAX, type RecipientGroupView } from "@planer/shared";
import type { Db } from "../db/client";
import { employees, recipientGroupMembers, recipientGroups } from "../db/schema";
import type { Result } from "../polls/poll-service";

type GroupResult = Result & { group?: RecipientGroupView };

function liveGroups(db: Db) {
  return db.select().from(recipientGroups).where(isNull(recipientGroups.archivedAt)).all();
}

/** Только активные: строка участника уволенного остаётся, но в состав он не входит. */
function activeMemberIds(db: Db, groupId: number): number[] {
  return db.select({ id: recipientGroupMembers.employeeId })
    .from(recipientGroupMembers)
    .innerJoin(employees, eq(employees.id, recipientGroupMembers.employeeId))
    .where(and(eq(recipientGroupMembers.groupId, groupId), eq(employees.isActive, true)))
    .orderBy(asc(recipientGroupMembers.employeeId))
    .all()
    .map((r) => r.id);
}

export function getGroup(db: Db, id: number): RecipientGroupView | null {
  const g = db.select().from(recipientGroups).where(and(eq(recipientGroups.id, id), isNull(recipientGroups.archivedAt))).get();
  return g ? { id: g.id, name: g.name, memberIds: activeMemberIds(db, g.id) } : null;
}

export function listGroups(db: Db): RecipientGroupView[] {
  return liveGroups(db)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .map((g) => ({ id: g.id, name: g.name, memberIds: activeMemberIds(db, g.id) }));
}

/** Имя сравнивается без регистра: «ЧИП 5» и «чип 5» на кнопках не различить. */
function nameTaken(db: Db, name: string, exceptId: number | null): boolean {
  const key = name.toLocaleLowerCase("ru");
  return liveGroups(db).some((g) => g.id !== exceptId && g.name.toLocaleLowerCase("ru") === key);
}

/** В составе — только существующие сотрудники; архивного добавить можно: вернётся — будет в группе. */
function unknownMember(db: Db, ids: number[]): boolean {
  if (ids.length === 0) return false;
  return db.select({ id: employees.id }).from(employees).where(inArray(employees.id, ids)).all().length !== ids.length;
}

function replaceMembers(db: Db, groupId: number, ids: number[]): void {
  db.delete(recipientGroupMembers).where(eq(recipientGroupMembers.groupId, groupId)).run();
  for (const employeeId of ids) db.insert(recipientGroupMembers).values({ groupId, employeeId }).run();
}

export function createGroup(db: Db, input: { name: string; memberIds: number[] }, createdBy: number): GroupResult {
  if (liveGroups(db).length >= RECIPIENT_GROUPS_MAX) return { ok: false, error: `Групп уже ${RECIPIENT_GROUPS_MAX} — удали лишнюю.` };
  if (nameTaken(db, input.name, null)) return { ok: false, error: "Группа с таким названием уже есть." };
  if (unknownMember(db, input.memberIds)) return { ok: false, error: "В составе есть человек, которого нет в команде." };
  const id = db.transaction((tx) => {
    const g = tx.insert(recipientGroups).values({ name: input.name, createdBy }).returning().get();
    replaceMembers(tx as unknown as Db, g.id, input.memberIds);
    return g.id;
  });
  return { ok: true, group: getGroup(db, id)! };
}

export function updateGroup(db: Db, id: number, patch: { name?: string; memberIds?: number[] }): GroupResult {
  if (!getGroup(db, id)) return { ok: false, error: "Группы больше нет." };
  if (patch.name !== undefined && nameTaken(db, patch.name, id)) return { ok: false, error: "Группа с таким названием уже есть." };
  if (patch.memberIds !== undefined && unknownMember(db, patch.memberIds)) {
    return { ok: false, error: "В составе есть человек, которого нет в команде." };
  }
  db.transaction((tx) => {
    if (patch.name !== undefined) tx.update(recipientGroups).set({ name: patch.name }).where(eq(recipientGroups.id, id)).run();
    if (patch.memberIds !== undefined) replaceMembers(tx as unknown as Db, id, patch.memberIds);
  });
  return { ok: true, group: getGroup(db, id)! };
}

export function archiveGroup(db: Db, id: number): Result {
  const changed = db.update(recipientGroups).set({ archivedAt: new Date() })
    .where(and(eq(recipientGroups.id, id), isNull(recipientGroups.archivedAt))).run();
  return changed.changes > 0 ? { ok: true } : { ok: false, error: "Группы больше нет." };
}
