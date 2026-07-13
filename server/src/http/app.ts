import { Hono } from "hono";
import type { Db } from "../db/client";
import type { Config } from "../config";
import { validateInitData, type TelegramUser } from "../auth/telegram";
import { issueToken } from "../auth/jwt";
import { requireAuth, requireAdmin, type Env } from "./middleware";
import { listActiveTemplates } from "../repo/templates";
import { listUpcomingForEmployee, listShiftsInRange } from "../repo/shifts";
import { getByTelegramId, getEmployeeById, createAdminEmployee, listActive } from "../repo/employees";

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
    return c.json({ id: me.id, displayName: me.displayName, isAdmin: me.isAdmin });
  });

  app.get("/api/templates", requireAuth(config.jwtSecret), (c) => c.json({ templates: listActiveTemplates(db) }));

  app.get("/api/my/shifts", requireAuth(config.jwtSecret), (c) => {
    const from = c.req.query("from") ?? new Date().toISOString().slice(0, 10);
    return c.json({ shifts: listUpcomingForEmployee(db, c.get("auth").employeeId, from) });
  });

  app.get("/api/team/schedule", requireAuth(config.jwtSecret), (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) return c.json({ error: "from and to are required" }, 400);
    return c.json({ shifts: listShiftsInRange(db, from, to) });
  });

  app.get("/api/admin/employees", requireAdmin(config.jwtSecret), (c) => c.json({ employees: listActive(db) }));

  return app;
}
