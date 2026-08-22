import { Hono } from "hono";
import { z } from "zod";
import { checklistsDueToday, dateStr, isChecklistComplete } from "@planer/shared";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import {
  activeChecklistItems,
  createChecklistItem,
  deactivateChecklistItem,
  getChecklistItem,
  listMarksFor,
  listMarksOnDate,
  reorderChecklistItem,
  setMark,
  updateChecklistItem,
} from "../../repo/checklist";
import {
  createChecklist,
  deleteChecklist,
  getChecklist,
  listChecklists,
  setTemplateChecklist,
  updateChecklist,
} from "../../repo/checklists";
import { listShiftsOverlapping } from "../../repo/shifts";
import { listActiveTemplates } from "../../repo/templates";
import { getEmployeeById } from "../../repo/employees";
import { recordAudit } from "../../repo/audit";
import { teamNow } from "../../util/team-time";
import { requireAdmin, requireAuth, type Env } from "../middleware";

/** Какой чек-лист у какого вида смены — карта, которой отвечает `checklistsDueToday`. */
export function checklistByTemplate(db: Db): Map<number, number> {
  const pairs = listActiveTemplates(db).flatMap((t) => (t.checklistId != null ? [[t.id, t.checklistId] as const] : []));
  return new Map(pairs);
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

const nameSchema = z.object({ name: z.string().trim().min(1).max(120) });
const titleSchema = z.object({ title: z.string().trim().min(1).max(200) });

/**
 * Правка пункта: подпись и/или пояснение, любое поле по отдельности.
 *
 * Потолок пояснения — 2000, тот же, что у багрепорта: текст уезжает в сообщение
 * Telegram, у которого предел 4096 на всё вместе со списком пунктов.
 */
const itemPatchSchema = z
  .object({ title: z.string().trim().min(1).max(200).optional(), note: z.string().max(2000).nullish() })
  .refine((v) => v.title !== undefined || v.note !== undefined, { message: "нечего менять" });

/** Имя и инструкция чек-листа. Файла здесь нет — он приезжает от Telegram через бота. */
const checklistPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    note: z.string().max(2000).nullish(),
    docUrl: z.string().trim().max(500).nullish(),
  })
  .refine((v) => v.name !== undefined || v.note !== undefined || v.docUrl !== undefined, { message: "нечего менять" });

/** Наружу отдаём всё, кроме `docFileId`: это ключ к файлу в Telegram, и фронтам он не нужен. */
function checklistView(db: Db, id: number) {
  const list = getChecklist(db, id);
  if (!list) return null;
  return {
    id: list.id,
    name: list.name,
    note: list.note,
    docUrl: list.docUrl,
    docName: list.docName,
    hasDoc: list.docFileId != null,
    items: activeChecklistItems(db, list.id).map((item) => ({ id: item.id, title: item.title, note: item.note })),
    templateIds: listActiveTemplates(db).filter((t) => t.checklistId === list.id).map((t) => t.id),
  };
}

export function createChecklistRoutes(db: Db, config: Config) {
  const app = new Hono<Env>();
  const allViews = () => listChecklists(db).map((list) => checklistView(db, list.id)!);

  // ——— чек-листы целиком: только админ ———

  app.get("/api/admin/checklists", requireAdmin(db, config.jwtSecret), (c) => c.json({ checklists: allViews() }));

  app.post("/api/admin/checklists", requireAdmin(db, config.jwtSecret), async (c) => {
    const parsed = nameSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    const created = createChecklist(db, parsed.data.name);
    recordAudit(db, "checklist_changed", c.get("auth").employeeId, { name: created.name, action: "created" });
    return c.json({ checklist: checklistView(db, created.id) }, 201);
  });

  app.patch("/api/admin/checklists/:id", requireAdmin(db, config.jwtSecret), async (c) => {
    const id = Number(c.req.param("id"));
    const parsed = checklistPatchSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    if (!getChecklist(db, id)) return c.json({ error: "not_found" }, 404);
    updateChecklist(db, id, parsed.data);
    return c.json({ checklist: checklistView(db, id) });
  });

  app.delete("/api/admin/checklists/:id", requireAdmin(db, config.jwtSecret), (c) => {
    const id = Number(c.req.param("id"));
    const list = getChecklist(db, id);
    if (list) {
      deleteChecklist(db, id);
      recordAudit(db, "checklist_changed", c.get("auth").employeeId, { name: list.name, action: "deleted" });
    }
    return c.json({ checklists: allViews() });
  });

  /** Снять приложенный файл. Положить его можно только через бота. */
  app.delete("/api/admin/checklists/:id/doc", requireAdmin(db, config.jwtSecret), (c) => {
    const id = Number(c.req.param("id"));
    if (!getChecklist(db, id)) return c.json({ error: "not_found" }, 404);
    updateChecklist(db, id, { docFileId: null, docName: null });
    return c.json({ checklist: checklistView(db, id) });
  });

  /**
   * Кому положен этот чек-лист — списком видов смен.
   *
   * Здесь, а не только на «Видах смен»: «скоп смен» — это вопрос к чек-листу
   * («кто его проходит»), и отвечать на него, обходя девять карточек пресетов,
   * значит спрашивать девять раз вместо одного. На «Видах смен» та же привязка
   * остаётся с другой стороны — там она свойство пресета.
   */
  app.put("/api/admin/checklists/:id/templates", requireAdmin(db, config.jwtSecret), async (c) => {
    const id = Number(c.req.param("id"));
    if (!getChecklist(db, id)) return c.json({ error: "not_found" }, 404);
    const parsed = z.object({ templateIds: z.array(z.number().int()) }).safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);

    const wanted = new Set(parsed.data.templateIds);
    db.transaction(() => {
      for (const template of listActiveTemplates(db)) {
        const should = wanted.has(template.id);
        if (should && template.checklistId !== id) setTemplateChecklist(db, template.id, id);
        // Снимаем только СВОЮ привязку: вид смены, отданный другому чек-листу,
        // этот запрос не касается, иначе сохранение одного списка молча
        // отвязывало бы виды смен у соседнего.
        else if (!should && template.checklistId === id) setTemplateChecklist(db, template.id, null);
      }
    });
    return c.json({ checklist: checklistView(db, id) });
  });

  // ——— пункты ———

  app.post("/api/admin/checklists/:id/items", requireAdmin(db, config.jwtSecret), async (c) => {
    const checklistId = Number(c.req.param("id"));
    if (!getChecklist(db, checklistId)) return c.json({ error: "not_found" }, 404);
    const parsed = titleSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    createChecklistItem(db, checklistId, parsed.data.title);
    return c.json({ checklist: checklistView(db, checklistId) }, 201);
  });

  app.patch("/api/admin/checklist/items/:id", requireAdmin(db, config.jwtSecret), async (c) => {
    const parsed = itemPatchSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    const item = updateChecklistItem(db, Number(c.req.param("id")), parsed.data);
    if (!item) return c.json({ error: "not_found" }, 404);
    return c.json({ checklist: item.checklistId != null ? checklistView(db, item.checklistId) : null });
  });

  app.post("/api/admin/checklist/items/:id/order", requireAdmin(db, config.jwtSecret), async (c) => {
    const parsed = z.object({ to: z.number().int().min(0) }).safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    const item = getChecklistItem(db, Number(c.req.param("id")));
    if (!item?.checklistId) return c.json({ error: "not_found" }, 404);
    reorderChecklistItem(db, item.checklistId, item.id, parsed.data.to);
    return c.json({ checklist: checklistView(db, item.checklistId) });
  });

  // Гасит, а не удаляет: на пункт ссылаются вчерашние отметки, а история «что
  // проверяли в августе» — ровно то, ради чего чек-лист заводят.
  app.delete("/api/admin/checklist/items/:id", requireAdmin(db, config.jwtSecret), (c) => {
    const item = getChecklistItem(db, Number(c.req.param("id")));
    if (!item?.checklistId) return c.json({ error: "not_found" }, 404);
    deactivateChecklistItem(db, item.id);
    return c.json({ checklist: checklistView(db, item.checklistId) });
  });

  /** Сводка на день: кому что положено и сколько отмечено. */
  app.get("/api/admin/checklist/day", requireAdmin(db, config.jwtSecret), (c) => {
    const date = dateStr.safeParse(c.req.query("date")).data ?? teamNow(config.teamTz).date;
    const byTemplate = checklistByTemplate(db);
    const marks = listMarksOnDate(db, date);

    const seen = new Set<string>();
    const people = listShiftsOverlapping(db, date, date).flatMap((shift) => {
      const employeeId = shift.employeeId;
      if (employeeId == null || shift.templateId == null) return [];
      const checklistId = byTemplate.get(shift.templateId);
      if (checklistId == null) return [];
      const key = `${employeeId}:${checklistId}`;
      if (seen.has(key)) return [];
      seen.add(key);

      const items = activeChecklistItems(db, checklistId);
      const itemIds = new Set(items.map((item) => item.id));
      const done = marks.filter((m) => m.employeeId === employeeId && itemIds.has(m.itemId)).length;
      return [{
        employeeId,
        displayName: getEmployeeById(db, employeeId)?.displayName ?? `работник #${employeeId}`,
        checklistId,
        checklistName: getChecklist(db, checklistId)?.name ?? "чек-лист",
        done,
        total: items.length,
      }];
    });

    return c.json({ date, people });
  });

  // ——— свой чек-лист: любой работник, но только свой ———

  /**
   * `employeeId` берётся из подписи и в теле его нет ВООБЩЕ — ни здесь, ни в
   * отметке. Приняв его из тела, ручка позволила бы отметиться за коллегу.
   */
  app.get("/api/my/checklist", requireAuth(db, config.jwtSecret), (c) => {
    const employeeId = c.get("auth").employeeId;
    const date = dateStr.safeParse(c.req.query("date")).data ?? teamNow(config.teamTz).date;
    const marked = listMarksFor(db, date, employeeId).map((m) => m.itemId);

    const checklists = checklistsFor(db, date, employeeId).flatMap((id) => {
      const list = getChecklist(db, id);
      const items = activeChecklistItems(db, id);
      // Пустой чек-лист не показывается вовсе: заголовок над пустотой читается
      // как «пункты не загрузились», а проходить действительно нечего.
      if (!list || items.length === 0) return [];
      return [{
        id: list.id,
        name: list.name,
        note: list.note,
        docUrl: list.docUrl,
        // Имя файла, а не сам файл: документ приходит в чат от бота, и экран
        // должен сказать, где его искать, а не притворяться, что покажет сам.
        docName: list.docName,
        items: items.map((item) => ({ id: item.id, title: item.title, note: item.note })),
        markedItemIds: items.filter((item) => marked.includes(item.id)).map((item) => item.id),
      }];
    });

    return c.json({ date, checklists });
  });

  app.post("/api/my/checklist/mark", requireAuth(db, config.jwtSecret), async (c) => {
    const parsed = z
      .object({ date: dateStr, itemId: z.number().int(), done: z.boolean() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    const employeeId = c.get("auth").employeeId;
    const { date, itemId, done } = parsed.data;

    const item = getChecklistItem(db, itemId);
    if (!item?.checklistId || !item.isActive) return c.json({ error: "unknown_item" }, 400);
    // Отметить можно только пункт СВОЕГО сегодняшнего чек-листа: иначе дежурный
    // с восьми закрывал бы проверки того, кто выходит в семь.
    if (!checklistsFor(db, date, employeeId).includes(item.checklistId)) return c.json({ error: "not_your_day" }, 400);

    setMark(db, { date, employeeId, itemId, done });
    const items = activeChecklistItems(db, item.checklistId);
    const markedItemIds = listMarksFor(db, date, employeeId)
      .map((m) => m.itemId)
      .filter((id) => items.some((i) => i.id === id));

    // Строка журнала — на переход в «пройден», а не на каждый тап.
    if (done && isChecklistComplete(items, markedItemIds)) {
      recordAudit(db, "checklist_completed", employeeId, {
        employeeId,
        employeeName: getEmployeeById(db, employeeId)?.displayName ?? null,
        date,
        checklistName: getChecklist(db, item.checklistId)?.name ?? null,
        total: items.length,
      });
    }

    return c.json({ checklistId: item.checklistId, markedItemIds });
  });

  return app;
}
