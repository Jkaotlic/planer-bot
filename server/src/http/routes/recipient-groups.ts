import { Hono, type Context } from "hono";
import { recipientGroupInputSchema, recipientGroupPatchSchema } from "@planer/shared";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { recordAudit } from "../../repo/audit";
import { requireAdmin, requireAuth, type Env } from "../middleware";
import { jsonBody } from "../json-body";
import { archiveGroup, createGroup, getGroup, listGroups, updateGroup } from "../../groups/group-service";

/**
 * Группы адресатов: читает любой вошедший (форма рассылки у работника тоже
 * показывает кнопки групп), правит только админ — состав группы решает,
 * кому уйдёт сбор, и это не должно меняться чужой рукой.
 */
export function createRecipientGroupRoutes(db: Db, config: Config): Hono<Env> {
  const app = new Hono<Env>();
  const auth = requireAuth(db, config.jwtSecret);
  const admin = requireAdmin(db, config.jwtSecret);
  const invalid = (issues: unknown) => ({ error: "Проверь название (до 40 символов) и состав.", issues });
  const body = async (c: Context) => jsonBody(c);

  app.get("/api/recipient-groups", auth, (c) => c.json({ groups: listGroups(db) }));

  app.post("/api/admin/recipient-groups", admin, async (c) => {
    const parsed = recipientGroupInputSchema.safeParse(await body(c));
    if (!parsed.success) return c.json(invalid(parsed.error.issues), 400);
    const actor = c.get("auth").employeeId;
    const result = createGroup(db, parsed.data, actor);
    if (!result.ok) return c.json({ error: result.error }, 409);
    const group = result.group!;
    recordAudit(db, "recipient_group_changed", actor, { groupId: group.id, name: group.name, action: "создана", members: group.memberIds.length });
    return c.json({ group }, 201);
  });

  app.put("/api/admin/recipient-groups/:id", admin, async (c) => {
    const parsed = recipientGroupPatchSchema.safeParse(await body(c));
    if (!parsed.success) return c.json(invalid(parsed.error.issues), 400);
    const result = updateGroup(db, Number(c.req.param("id")), parsed.data);
    if (!result.ok) return c.json({ error: result.error }, 409);
    const group = result.group!;
    recordAudit(db, "recipient_group_changed", c.get("auth").employeeId, { groupId: group.id, name: group.name, action: "изменена", members: group.memberIds.length });
    return c.json({ group });
  });

  app.delete("/api/admin/recipient-groups/:id", admin, (c) => {
    const id = Number(c.req.param("id"));
    // Группа читается ДО архивации: после неё имени и состава уже не достать,
    // а строка журнала «удалена» без названия не говорит, какая именно.
    const before = getGroup(db, id);
    const result = archiveGroup(db, id);
    if (!result.ok) return c.json({ error: result.error }, 404);
    recordAudit(db, "recipient_group_changed", c.get("auth").employeeId, { groupId: id, name: before?.name, action: "удалена", members: before?.memberIds.length ?? 0 });
    return c.json({ ok: true });
  });

  return app;
}
