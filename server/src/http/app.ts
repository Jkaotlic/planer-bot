import { Hono } from "hono";
import type { Db } from "../db/client";
import type { Config } from "../config";
import { validateInitData, type TelegramUser } from "../auth/telegram";
import { issueToken } from "../auth/jwt";
import { requireAuth, requireAdmin, type Env } from "./middleware";
import { listActiveTemplates } from "../repo/templates";
import { createShift, updateShift, deleteShift, listUpcomingForEmployee, listShiftsInRange } from "../repo/shifts";
import { getByTelegramId, getEmployeeById, createAdminEmployee, listActive } from "../repo/employees";
import { createEntrySchema, updateEntrySchema } from "./entry-schema";

export interface AppDeps {
  db: Db;
  config: Config;
}

function displayNameOf(u: TelegramUser): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return name || u.username || "Без имени";
}

export function createApp(deps: AppDeps): Hono<Env> {
  const { db, config } = deps;
  const app = new Hono<Env>();

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.post("/api/auth", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { initData?: unknown };
    const initData = typeof body.initData === "string" ? body.initData : (c.req.header("X-Init-Data") ?? "");
    let user: TelegramUser;
    try {
      user = validateInitData(initData, config.botToken).user;
    } catch {
      return c.json({ error: "invalid_init_data" }, 401);
    }

    const allowlisted = config.adminTelegramIds.includes(user.id);
    let employee = getByTelegramId(db, user.id);
    if (employee && !employee.isActive) return c.json({ error: "not_registered" }, 403);
    if (!employee) {
      if (!allowlisted) return c.json({ error: "not_registered" }, 403);
      employee = createAdminEmployee(db, { telegramUserId: user.id, tgUsername: user.username, displayName: displayNameOf(user) });
    }
    const isAdmin = employee.isAdmin || allowlisted;
    const token = await issueToken({ employeeId: employee.id, isAdmin }, config.jwtSecret);
    return c.json({ token, employee: { id: employee.id, displayName: employee.displayName, isAdmin } });
  });

  app.get("/api/me", requireAuth(config.jwtSecret), (c) => {
    const me = getEmployeeById(db, c.get("auth").employeeId);
    if (!me) return c.json({ error: "not_found" }, 404);
    return c.json({ id: me.id, displayName: me.displayName, isAdmin: c.get("auth").isAdmin });
  });

  app.get("/api/templates", requireAuth(config.jwtSecret), (c) => c.json({ templates: listActiveTemplates(db) }));

  app.get("/api/my/shifts", requireAuth(config.jwtSecret), (c) => {
    const from = c.req.query("from") ?? new Intl.DateTimeFormat("en-CA", { timeZone: config.teamTz }).format(new Date());
    return c.json({ shifts: listUpcomingForEmployee(db, c.get("auth").employeeId, from) });
  });

  app.get("/api/team/schedule", requireAuth(config.jwtSecret), (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) return c.json({ error: "from and to are required" }, 400);
    return c.json({ shifts: listShiftsInRange(db, from, to) });
  });

  app.get("/api/admin/employees", requireAdmin(config.jwtSecret), (c) => c.json({ employees: listActive(db) }));

  app.post("/api/admin/entries", requireAdmin(config.jwtSecret), async (c) => {
    const parsed = createEntrySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    return c.json({ entry: createShift(db, parsed.data) }, 201);
  });

  app.patch("/api/admin/entries/:id", requireAdmin(config.jwtSecret), async (c) => {
    const id = Number(c.req.param("id"));
    const parsed = updateEntrySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    const entry = updateShift(db, id, parsed.data);
    if (!entry) return c.json({ error: "not_found" }, 404);
    return c.json({ entry });
  });

  app.delete("/api/admin/entries/:id", requireAdmin(config.jwtSecret), (c) => {
    const id = Number(c.req.param("id"));
    if (!deleteShift(db, id)) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  return app;
}
