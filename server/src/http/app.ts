import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { Bot } from "grammy";
import type { Db } from "../db/client";
import type { Config } from "../config";
import { validateInitData, type TelegramUser } from "../auth/telegram";
import { issueToken } from "../auth/jwt";
import { requireAuth, requireAdmin, type Env } from "./middleware";
import { listActiveTemplates } from "../repo/templates";
import { createShift, updateShift, deleteShift, getShift, listUpcomingForEmployee, listShiftsInRange } from "../repo/shifts";
import type { Shift } from "../db/schema";
import {
  getByTelegramId,
  getEmployeeById,
  createAdminEmployee,
  createEmployee,
  listActive,
  archiveEmployee,
  restoreEmployee,
} from "../repo/employees";
import { createEntrySchema, updateEntrySchema, entryTimesError } from "./entry-schema";
import { createSwap, acceptSwap, declineSwap, cancelSwap } from "../swap/swap-service";
import { listSwapsForEmployee } from "../repo/swaps";
import { listRecentAudit } from "../repo/audit";
import { notifyUser, notifyAdmins } from "../bot/notify";
import { teamNow } from "../util/team-time";

export interface AppDeps {
  db: Db;
  config: Config;
  bot?: Bot;
}

function displayNameOf(u: TelegramUser): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return name || u.username || "Без имени";
}

export function createApp(deps: AppDeps): Hono<Env> {
  const { db, config, bot } = deps;
  const app = new Hono<Env>();

  app.onError((err, c) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (/FOREIGN KEY/i.test(msg)) return c.json({ error: "invalid_reference" }, 400);
    console.error("unhandled error:", err);
    return c.json({ error: "internal" }, 500);
  });

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

  app.get("/api/employees", requireAuth(config.jwtSecret), (c) =>
    c.json({ employees: listActive(db).map((e) => ({ id: e.id, displayName: e.displayName })) }),
  );

  app.get("/api/admin/employees", requireAdmin(config.jwtSecret), (c) => c.json({ employees: listActive(db) }));

  app.post("/api/admin/employees", requireAdmin(config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { displayName?: unknown };
    if (typeof body.displayName !== "string" || body.displayName.trim().length === 0) {
      return c.json({ error: "displayName is required" }, 400);
    }
    const inviteToken = randomBytes(16).toString("hex");
    const employee = createEmployee(db, { displayName: body.displayName, inviteToken });
    const inviteLink = config.botUsername ? `https://t.me/${config.botUsername}?start=${inviteToken}` : null;
    return c.json({ employee, inviteToken, inviteLink }, 201);
  });

  app.post("/api/admin/employees/:id/archive", requireAdmin(config.jwtSecret), (c) => {
    const id = Number(c.req.param("id"));
    const employee = archiveEmployee(db, id, teamNow(config.teamTz).date);
    if (!employee) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  app.post("/api/admin/employees/:id/restore", requireAdmin(config.jwtSecret), (c) => {
    const id = Number(c.req.param("id"));
    const employee = restoreEmployee(db, id);
    if (!employee) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  app.get("/api/admin/events", requireAdmin(config.jwtSecret), (c) => {
    const events = listRecentAudit(db, 30).map((row) => ({
      id: row.id,
      type: row.type,
      createdAt: row.createdAt,
      actorName: row.actorEmployeeId != null ? (getEmployeeById(db, row.actorEmployeeId)?.displayName ?? null) : null,
      payload: row.payload,
    }));
    return c.json({ events });
  });

  app.post("/api/admin/entries", requireAdmin(config.jwtSecret), async (c) => {
    const parsed = createEntrySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    return c.json({ entry: createShift(db, parsed.data) }, 201);
  });

  app.patch("/api/admin/entries/:id", requireAdmin(config.jwtSecret), async (c) => {
    const id = Number(c.req.param("id"));
    const parsed = updateEntrySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    const existing = getShift(db, id);
    if (!existing) return c.json({ error: "not_found" }, 404);
    const patch = parsed.data;
    const merged = {
      category: patch.category ?? existing.category,
      start: patch.start !== undefined ? patch.start : existing.start,
      end: patch.end !== undefined ? patch.end : existing.end,
    };
    const err = entryTimesError(merged);
    if (err) return c.json({ error: "invalid", issues: [{ message: err }] }, 400);
    const entry = updateShift(db, id, patch);
    if (!entry) return c.json({ error: "not_found" }, 404);
    return c.json({ entry });
  });

  app.delete("/api/admin/entries/:id", requireAdmin(config.jwtSecret), (c) => {
    const id = Number(c.req.param("id"));
    if (!deleteShift(db, id)) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  const tgOf = (employeeId: number): number | null => getEmployeeById(db, employeeId)?.telegramUserId ?? null;

  type ShiftSummary = { date: string; start: string | null; end: string | null; title: string | null };
  const shiftSummaryOf = (shiftId: number): ShiftSummary | null => {
    const shift: Shift | undefined = getShift(db, shiftId);
    if (!shift) return null;
    return { date: shift.date, start: shift.start, end: shift.end, title: shift.title };
  };
  const nameOf = (employeeId: number): string | null => getEmployeeById(db, employeeId)?.displayName ?? null;

  app.post("/api/swaps", requireAuth(config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { fromShiftId?: number; toShiftId?: number; message?: string };
    if (typeof body.fromShiftId !== "number" || typeof body.toShiftId !== "number") return c.json({ error: "fromShiftId and toShiftId required" }, 400);
    if (body.message !== undefined && (typeof body.message !== "string" || body.message.length > 500)) return c.json({ error: "invalid_message" }, 400);
    const res = createSwap(db, { fromEmployeeId: c.get("auth").employeeId, fromShiftId: body.fromShiftId, toShiftId: body.toShiftId, message: body.message });
    if (!res.ok) return c.json({ error: res.reason }, 400);
    if (bot) { const tg = tgOf(res.counterpartyId); if (tg != null) await notifyUser(bot, tg, "Тебе предложили обмен сменой. Открой приложение, чтобы ответить."); }
    return c.json({ request: res.request }, 201);
  });

  app.post("/api/swaps/:id/accept", requireAuth(config.jwtSecret), async (c) => {
    const res = acceptSwap(db, Number(c.req.param("id")), c.get("auth").employeeId, teamNow(config.teamTz));
    if (!res.ok) return c.json({ error: res.reason }, 400);
    if (bot) {
      const tg = tgOf(res.counterpartyId); if (tg != null) await notifyUser(bot, tg, "Твой обмен приняли ✅ Смены поменялись.");
      await notifyAdmins(bot, db, "Обмен сменами состоялся.");
    }
    return c.json({ ok: true });
  });

  app.post("/api/swaps/:id/decline", requireAuth(config.jwtSecret), async (c) => {
    const res = declineSwap(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!res.ok) return c.json({ error: res.reason }, 400);
    if (bot) { const tg = tgOf(res.counterpartyId); if (tg != null) await notifyUser(bot, tg, "Твой обмен отклонили."); }
    return c.json({ ok: true });
  });

  app.post("/api/swaps/:id/cancel", requireAuth(config.jwtSecret), async (c) => {
    const res = cancelSwap(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!res.ok) return c.json({ error: res.reason }, 400);
    if (bot) { const tg = tgOf(res.counterpartyId); if (tg != null) await notifyUser(bot, tg, "Заявку на обмен отменили."); }
    return c.json({ ok: true });
  });

  app.get("/api/swaps", requireAuth(config.jwtSecret), (c) => {
    const me = c.get("auth").employeeId;
    const swaps = listSwapsForEmployee(db, me).map((row) => {
      const outgoing = row.fromEmployeeId === me;
      const counterpartyId = outgoing ? row.toEmployeeId : row.fromEmployeeId;
      const yourShiftId = outgoing ? row.fromShiftId : row.toShiftId;
      const theirShiftId = outgoing ? row.toShiftId : row.fromShiftId;
      return {
        id: row.id,
        status: row.status,
        message: row.message,
        createdAt: row.createdAt,
        direction: outgoing ? "outgoing" : "incoming",
        counterpartyName: nameOf(counterpartyId),
        yourShift: shiftSummaryOf(yourShiftId),
        theirShift: shiftSummaryOf(theirShiftId),
      };
    });
    return c.json({ swaps });
  });

  return app;
}
