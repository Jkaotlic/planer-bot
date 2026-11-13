import { checklistsDueToday, isChecklistComplete, prevDate } from "@planer/shared";
import type { Db } from "../db/client";
import { activeChecklistItems, getChecklistItem, listMarksFor, setMark } from "../repo/checklist";
import { checklistIdsByTemplate, getChecklist } from "../repo/checklists";
import { listActiveTemplates } from "../repo/templates";
import { listShiftsOverlapping } from "../repo/shifts";
import { getEmployeeById } from "../repo/employees";
import { recordAudit } from "../repo/audit";

/**
 * Какие чек-листы у какого вида смены — карта, которой отвечает `checklistsDueToday`.
 *
 * Только активные виды смен: смен погашенного пресета не ставят, а его связи
 * пережили бы его в таблице и приносили бы списки задним числом.
 */
export function checklistByTemplate(db: Db): Map<number, number[]> {
  const active = new Set(listActiveTemplates(db).map((t) => t.id));
  return new Map([...checklistIdsByTemplate(db)].filter(([templateId]) => active.has(templateId)));
}

/**
 * Какие чек-листы человек проходит в этот день.
 *
 * `listShiftsOverlapping`, а не `listShiftsInRange`: многодневная запись,
 * начавшаяся раньше, второй не видна вовсе.
 */
export function checklistsFor(db: Db, date: string, employeeId: number): number[] {
  return checklistsDueToday(listShiftsOverlapping(db, date, date), checklistByTemplate(db), date, employeeId);
}

/** Оба интерфейса используют одно правило для ночной смены. */
export function canMarkChecklistDate(date: string, today: string): boolean {
  return date === today || date === prevDate(today);
}

export function markChecklistItem(
  db: Db,
  input: { date: string; employeeId: number; itemId: number; done: boolean; checklistId?: number },
  today: string,
): { checklistId: number; markedItemIds: number[] } | { error: string } {
  const { date, employeeId, itemId, done } = input;
  if (!canMarkChecklistDate(date, today)) {
    return { error: "Отмечать можно только сегодняшний и вчерашний чек-лист" };
  }
  return db.transaction((tx) => {
    const item = getChecklistItem(tx, itemId);
    if (!item?.checklistId || !item.isActive || (input.checklistId != null && input.checklistId !== item.checklistId)) {
      return { error: "unknown_item" };
    }
    const checklistId = item.checklistId;
    if (!checklistsFor(tx, date, employeeId).includes(checklistId)) return { error: "not_your_day" };
    const items = activeChecklistItems(tx, checklistId);
    const itemIds = new Set(items.map((entry) => entry.id));
    const before = listMarksFor(tx, date, employeeId).map((mark) => mark.itemId).filter((id) => itemIds.has(id));
    setMark(tx, input);
    const markedItemIds = done ? [...new Set([...before, itemId])] : before.filter((id) => id !== itemId);
    // Повторный тап или повтор доставки не должен создавать ещё одно завершение.
    if (!isChecklistComplete(items, before) && isChecklistComplete(items, markedItemIds)) {
      recordAudit(tx, "checklist_completed", employeeId, {
        employeeId,
        employeeName: getEmployeeById(tx, employeeId)?.displayName ?? null,
        date,
        checklistName: getChecklist(tx, checklistId)?.name ?? null,
        total: items.length,
      });
    }
    return { checklistId, markedItemIds };
  });
}
