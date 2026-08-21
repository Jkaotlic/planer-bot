import { Hono } from "hono";
import { z } from "zod";
import { dateStr, isChecklistComplete, needsChecklistToday } from "@planer/shared";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import {
  activeChecklistItems,
  createChecklistItem,
  deactivateChecklistItem,
  listMarksFor,
  listMarksOnDate,
  renameChecklistItem,
  reorderChecklistItem,
  setMark,
} from "../../repo/checklist";
import { listShiftsOverlapping } from "../../repo/shifts";
import { listActiveTemplates } from "../../repo/templates";
import { getEmployeeById } from "../../repo/employees";
import { recordAudit } from "../../repo/audit";
import { teamNow } from "../../util/team-time";
import { requireAdmin, requireAuth, type Env } from "../middleware";

/** Пресеты, у которых стоит галочка «Требует чек-лист». */
export function templatesRequiringChecklist(db: Db): Set<number> {
  return new Set(listActiveTemplates(db).filter((t) => t.requiresChecklist).map((t) => t.id));
}

/**
 * Положен ли человеку чек-лист в этот день — по записям графика, накрывающим день.
 *
 * `listShiftsOverlapping`, а не `listShiftsInRange`: многодневная запись,
 * начавшаяся раньше, второй не видна вовсе.
 */
export function checklistRequiredFor(db: Db, date: string, employeeId: number): boolean {
  return needsChecklistToday(listShiftsOverlapping(db, date, date), templatesRequiringChecklist(db), date, employeeId);
}

const titleSchema = z.object({ title: z.string().trim().min(1).max(200) });
const markSchema = z.object({ date: dateStr, itemId: z.number().int(), done: z.boolean() });

export function createChecklistRoutes(db: Db, config: Config) {
  const app = new Hono<Env>();

  // ——— пункты: только админ ———

  app.get("/api/admin/checklist/items", requireAdmin(db, config.jwtSecret), (c) =>
    c.json({ items: activeChecklistItems(db) }),
  );

  app.post("/api/admin/checklist/items", requireAdmin(db, config.jwtSecret), async (c) => {
    const parsed = titleSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    return c.json({ item: createChecklistItem(db, parsed.data.title) }, 201);
  });

  app.patch("/api/admin/checklist/items/:id", requireAdmin(db, config.jwtSecret), async (c) => {
    const parsed = titleSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    const item = renameChecklistItem(db, Number(c.req.param("id")), parsed.data.title);
    if (!item) return c.json({ error: "not_found" }, 404);
    return c.json({ item });
  });

  app.post("/api/admin/checklist/items/:id/order", requireAdmin(db, config.jwtSecret), async (c) => {
    const parsed = z.object({ to: z.number().int().min(0) }).safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    reorderChecklistItem(db, Number(c.req.param("id")), parsed.data.to);
    return c.json({ items: activeChecklistItems(db) });
  });

  // Гасит, а не удаляет: на пункт ссылаются вчерашние отметки, а история «что
  // проверяли в августе» — ровно то, ради чего чек-лист заводят.
  app.delete("/api/admin/checklist/items/:id", requireAdmin(db, config.jwtSecret), (c) => {
    deactivateChecklistItem(db, Number(c.req.param("id")));
    return c.json({ items: activeChecklistItems(db) });
  });

  /** Сводка на день: кому положено и сколько отмечено. Для экрана «Чек-лист». */
  app.get("/api/admin/checklist/day", requireAdmin(db, config.jwtSecret), (c) => {
    const date = dateStr.safeParse(c.req.query("date")).data ?? teamNow(config.teamTz).date;
    const items = activeChecklistItems(db);
    const requiring = templatesRequiringChecklist(db);
    const marks = listMarksOnDate(db, date);
    const itemIds = new Set(items.map((item) => item.id));

    const byEmployee = new Map<number, number>();
    for (const mark of marks) {
      if (!itemIds.has(mark.itemId)) continue;
      byEmployee.set(mark.employeeId, (byEmployee.get(mark.employeeId) ?? 0) + 1);
    }

    const owed = listShiftsOverlapping(db, date, date).filter(
      (s) => s.employeeId != null && s.templateId != null && requiring.has(s.templateId),
    );
    const seen = new Set<number>();
    const people = owed.flatMap((shift) => {
      const employeeId = shift.employeeId!;
      if (seen.has(employeeId)) return [];
      seen.add(employeeId);
      return [{
        employeeId,
        displayName: getEmployeeById(db, employeeId)?.displayName ?? `работник #${employeeId}`,
        done: byEmployee.get(employeeId) ?? 0,
      }];
    });

    return c.json({ date, total: items.length, people });
  });

  // ——— свой чек-лист: любой работник, но только свой ———

  /**
   * `employeeId` берётся из подписи и в теле его нет ВООБЩЕ — ни здесь, ни в
   * отметке. Приняв его из тела, ручка позволила бы отметиться за коллегу; это
   * тот же довод, по которому у самозаписи своё тело без `employeeId`.
   */
  app.get("/api/my/checklist", requireAuth(db, config.jwtSecret), (c) => {
    const employeeId = c.get("auth").employeeId;
    const date = dateStr.safeParse(c.req.query("date")).data ?? teamNow(config.teamTz).date;
    const items = activeChecklistItems(db);
    // Пустой список — не «не положен», а «проходить нечего»: отвечаем
    // `required: false`, и ни бот, ни экран ничего не показывают.
    const required = items.length > 0 && checklistRequiredFor(db, date, employeeId);
    return c.json({
      date,
      required,
      items: required ? items : [],
      markedItemIds: required ? listMarksFor(db, date, employeeId).map((m) => m.itemId) : [],
    });
  });

  app.post("/api/my/checklist/mark", requireAuth(db, config.jwtSecret), async (c) => {
    const parsed = markSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    const employeeId = c.get("auth").employeeId;
    const { date, itemId, done } = parsed.data;

    const items = activeChecklistItems(db);
    if (!items.some((item) => item.id === itemId)) return c.json({ error: "unknown_item" }, 400);
    if (!checklistRequiredFor(db, date, employeeId)) return c.json({ error: "not_your_day" }, 400);

    setMark(db, { date, employeeId, itemId, done });
    const markedItemIds = listMarksFor(db, date, employeeId).map((m) => m.itemId);

    // Строка журнала — на переход в «пройден», а не на каждый тап. Снятие отметки
    // и повторное проставление того же последнего пункта дадут вторую строку; это
    // честнее, чем молчать, и такое бывает редко.
    if (done && isChecklistComplete(items, markedItemIds)) {
      recordAudit(db, "checklist_completed", employeeId, {
        employeeId,
        employeeName: getEmployeeById(db, employeeId)?.displayName ?? null,
        date,
        total: items.length,
      });
    }

    return c.json({ date, items, markedItemIds });
  });

  return app;
}
