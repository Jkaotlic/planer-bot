import { Hono } from "hono";
import type { Db } from "../db/client";
import type { Config } from "../config";
import { validateInitData, type TelegramUser } from "../auth/telegram";
import { issueToken } from "../auth/jwt";
import { getByTelegramId, getEmployeeById, createAdminEmployee } from "../repo/employees";
import { requireAuth, type Env } from "./middleware";

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

  return app;
}
