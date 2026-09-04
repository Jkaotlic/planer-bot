import { and, asc, eq, notInArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { checklists, checklistTemplates, type Checklist } from "../db/schema";

/**
 * Чек-листы как сущности: у каждого своё имя, своя инструкция и свои пункты.
 *
 * Именованные, а не один на систему: у дежурного с семи и у дежурного с восьми
 * проверки разные. «Скоп смен» задаётся с другой стороны — тем, какие виды смен
 * ссылаются на этот чек-лист (`checklist_templates`), и связь множественная в
 * обе стороны: один список обслуживает несколько видов, у одного вида бывает
 * несколько списков.
 */
export function listChecklists(db: Db): Checklist[] {
  return db.select().from(checklists).orderBy(asc(checklists.id)).all();
}

export function getChecklist(db: Db, id: number): Checklist | undefined {
  return db.select().from(checklists).where(eq(checklists.id, id)).get();
}

export function createChecklist(db: Db, name: string): Checklist {
  return db.insert(checklists).values({ name }).returning().all()[0]!;
}

/** Правит имя и/или инструкцию. `undefined` — «не трогать это поле». */
export function updateChecklist(
  db: Db,
  id: number,
  patch: {
    name?: string;
    note?: string | null;
    docUrl?: string | null;
    docFileId?: string | null;
    docName?: string | null;
    docPath?: string | null;
  },
): Checklist | undefined {
  const set: Record<string, string | null> = {};
  // Пустая строка стирает: «задано пустым» и «не задано» — одно и то же, а
  // пустое пояснение рисовало бы под списком пустой отступ.
  const clean = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.note !== undefined) set.note = clean(patch.note);
  if (patch.docUrl !== undefined) set.docUrl = clean(patch.docUrl);
  if (patch.docFileId !== undefined) set.docFileId = clean(patch.docFileId);
  if (patch.docName !== undefined) set.docName = clean(patch.docName);
  if (patch.docPath !== undefined) set.docPath = clean(patch.docPath);
  if (Object.keys(set).length === 0) return getChecklist(db, id);
  return db.update(checklists).set(set).where(eq(checklists.id, id)).returning().all()[0];
}

/**
 * Удаляет чек-лист вместе со ссылками на него у видов смен.
 *
 * Пункты при этом остаются — на них ссылаются отметки, и «что проверяли в
 * августе» из базы исчезать не должно. Они просто становятся ничьими и в
 * списках больше не появляются: активные пункты всегда читаются по
 * `checklistId`.
 */
export function deleteChecklist(db: Db, id: number): void {
  db.transaction(() => {
    db.delete(checklistTemplates).where(eq(checklistTemplates.checklistId, id)).run();
    db.delete(checklists).where(eq(checklists.id, id)).run();
  });
}

/**
 * Каким видам смен положен этот чек-лист.
 *
 * Порядок — по id вида смены: он же порядок кнопок на экране, и «Утро, Дежурство
 * с 07:00» не должно меняться местами от перезагрузки.
 */
export function templateIdsOf(db: Db, checklistId: number): number[] {
  return db
    .select({ templateId: checklistTemplates.templateId })
    .from(checklistTemplates)
    .where(eq(checklistTemplates.checklistId, checklistId))
    .orderBy(asc(checklistTemplates.templateId))
    .all()
    .map((row) => row.templateId);
}

/**
 * Переписывает привязки ОДНОГО чек-листа и больше ничего не трогает.
 *
 * До 2026-09-01 это была колонка на виде смены, и назначение вида второму
 * списку молча отнимало его у первого: инструкция 47 этажа перестала приходить
 * дежурным, а экран объяснил это как «не выбран вид смены». Теперь чужие строки
 * запросу не видны в принципе.
 *
 * Повтор в списке схлопывается: «назначен дважды» — это «назначен», а вторая
 * строка означала бы второе сообщение дежурному об одном и том же.
 */
export function setChecklistTemplates(db: Db, checklistId: number, templateIds: readonly number[]): void {
  const wanted = [...new Set(templateIds)];
  db.transaction(() => {
    const stale = wanted.length > 0
      ? db.delete(checklistTemplates).where(
          and(eq(checklistTemplates.checklistId, checklistId), notInArray(checklistTemplates.templateId, wanted)),
        )
      : db.delete(checklistTemplates).where(eq(checklistTemplates.checklistId, checklistId));
    stale.run();
    if (wanted.length === 0) return;
    // `onConflictDoNothing`, а не «удалить всё и вставить заново»: строку,
    // которая и так на месте, незачем трогать.
    db.insert(checklistTemplates)
      .values(wanted.map((templateId) => ({ checklistId, templateId })))
      .onConflictDoNothing()
      .run();
  });
}

/**
 * Та же связь с другой стороны: какие списки положены ОДНОМУ виду смены.
 *
 * Отдельной функцией, а не через `setChecklistTemplates` по каждому списку:
 * экран «Виды смен» правит одну строку и не должен для этого переписывать
 * привязки всех чек-листов подряд.
 */
export function setTemplatesChecklists(db: Db, templateId: number, checklistIds: readonly number[]): void {
  const wanted = [...new Set(checklistIds)];
  db.transaction(() => {
    const stale = wanted.length > 0
      ? db.delete(checklistTemplates).where(
          and(eq(checklistTemplates.templateId, templateId), notInArray(checklistTemplates.checklistId, wanted)),
        )
      : db.delete(checklistTemplates).where(eq(checklistTemplates.templateId, templateId));
    stale.run();
    if (wanted.length === 0) return;
    db.insert(checklistTemplates)
      .values(wanted.map((checklistId) => ({ checklistId, templateId })))
      .onConflictDoNothing()
      .run();
  });
}

/**
 * Карта «вид смены → его чек-листы» — то, чем `checklistsDueToday` отвечает на
 * вопрос «кому что сегодня положено».
 *
 * Порядок списков внутри вида — по id: дежурный получает сообщения в одном и
 * том же порядке изо дня в день, а не в том, в каком админ кликал кнопки.
 */
export function checklistIdsByTemplate(db: Db): Map<number, number[]> {
  const map = new Map<number, number[]>();
  const rows = db
    .select()
    .from(checklistTemplates)
    .orderBy(asc(checklistTemplates.templateId), asc(checklistTemplates.checklistId))
    .all();
  for (const row of rows) {
    const list = map.get(row.templateId);
    if (list) list.push(row.checklistId);
    else map.set(row.templateId, [row.checklistId]);
  }
  return map;
}
