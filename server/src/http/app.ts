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
  setEmployeeAdmin,
  countActiveAdmins,
  renameEmployee,
  setInviteToken,
} from "../repo/employees";
import { createEntrySchema, updateEntrySchema, entryTimesError, entryDateError } from "./entry-schema";
import { createSwap, acceptSwap, declineSwap, cancelSwap } from "../swap/swap-service";
import { listSwapsForEmployee } from "../repo/swaps";
import { listRecentAudit } from "../repo/audit";
import { notifyUser, notifyAdmins, notifySwapProposal, notifyVacantSlot, notifyWeekendOffer } from "../bot/notify";
import { teamNow } from "../util/team-time";
import { isWeekend, isAbsence, countsForBalance } from "@planer/shared";
import { buildDistribution, applyDistribution } from "../schedule/distribute-service";
import {
  postSlot,
  expressInterest,
  interestedForSlot,
  assignSlot,
  unassign,
  assigneesForSlot,
  confirmOffer,
  declineOffer,
  payrollRows,
  payrollCsv,
  openSlotsForWorker,
  myOffers,
} from "../weekend/weekend-service";
import { listOpenSlots, getVacantSlot } from "../repo/weekend";

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

  // API responses are live data — never let a browser / Telegram webview serve
  // a cached copy, or an admin's edits won't show up until the app is reopened.
  app.use("/api/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  // Defence in depth: everything under /api/admin/* is admin-only by construction,
  // so a route that forgets its inline requireAdmin still can't leak. The per-route
  // guards below stay as belt-and-suspenders.
  app.use("/api/admin/*", requireAdmin(config.jwtSecret));

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

  // Rename a worker.
  app.patch("/api/admin/employees/:id", requireAdmin(config.jwtSecret), async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { displayName?: unknown };
    if (typeof body.displayName !== "string" || body.displayName.trim().length === 0) {
      return c.json({ error: "displayName is required" }, 400);
    }
    const employee = renameEmployee(db, id, body.displayName.trim());
    if (!employee) return c.json({ error: "not_found" }, 404);
    return c.json({ employee });
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

  // Promote a worker to admin, or remove admin rights. Guarded so the team
  // can never demote its last admin and lock everyone out.
  app.post("/api/admin/employees/:id/role", requireAdmin(config.jwtSecret), async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { isAdmin?: unknown };
    if (typeof body.isAdmin !== "boolean") return c.json({ error: "isAdmin (boolean) required" }, 400);
    const target = getEmployeeById(db, id);
    if (!target) return c.json({ error: "not_found" }, 404);
    if (!body.isAdmin && target.isAdmin && countActiveAdmins(db) <= 1) {
      return c.json({ error: "last_admin" }, 400);
    }
    const employee = setEmployeeAdmin(db, id, body.isAdmin);
    return c.json({ employee });
  });

  // (Re)issue an invite link for a worker who hasn't linked their Telegram yet —
  // lets an admin re-show the link or replace a broken/lost one. `regenerate`
  // forces a fresh token (invalidating any previously shared link).
  app.post("/api/admin/employees/:id/invite", requireAdmin(config.jwtSecret), async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { regenerate?: unknown };
    const emp = getEmployeeById(db, id);
    if (!emp) return c.json({ error: "not_found" }, 404);
    if (emp.telegramUserId != null) return c.json({ error: "already_linked" }, 400);
    let inviteToken = emp.inviteToken;
    if (!inviteToken || body.regenerate === true) {
      inviteToken = randomBytes(16).toString("hex");
      setInviteToken(db, id, inviteToken);
    }
    const inviteLink = config.botUsername ? `https://t.me/${config.botUsername}?start=${inviteToken}` : null;
    return c.json({ inviteToken, inviteLink });
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
    const category = patch.category ?? existing.category;

    // Switching an entry's category has to drop the fields the new category can't
    // carry, or the edit gets rejected against the row's leftovers: turning a shift
    // into «Командировка» kept its 09:00–18:00 and tripped "absences must not have
    // times". The caller only sends what changed, so normalise here.
    if (isAbsence(category)) {
      patch.start = null;
      patch.end = null;
    } else if (countsForBalance(category)) {
      patch.endDate = null;
    }

    const merged = {
      category,
      date: patch.date ?? existing.date,
      start: patch.start !== undefined ? patch.start : existing.start,
      end: patch.end !== undefined ? patch.end : existing.end,
    };
    const err = entryTimesError(merged) ?? entryDateError(merged);
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

  /** "Пн 13 июл · 08:00–17:00"-style short line describing a shift, for chat notifications. */
  const shiftLineOf = (shiftId: number): string => {
    const shift = getShift(db, shiftId);
    if (!shift) return "смену";
    const parts = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
      .formatToParts(new Date(`${shift.date}T00:00:00Z`));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const weekday = get("weekday");
    const dateLabel = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${get("day")} ${get("month").replace(/\.$/, "")}`;
    const time = shift.start != null && shift.end != null ? ` · ${shift.start}–${shift.end}` : "";
    return `${dateLabel}${time}`;
  };

  /** "Сб 19 июл · 10:00–18:00 · Ярмарка" — short line describing a vacant slot for chat. */
  const slotLineOf = (s: { date: string; start: string; end: string; title?: string | null }): string => {
    const parts = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
      .formatToParts(new Date(`${s.date}T00:00:00Z`));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const weekday = get("weekday");
    const dateLabel = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${get("day")} ${get("month").replace(/\.$/, "")}`;
    const title = s.title ? ` · ${s.title}` : "";
    return `${dateLabel} · ${s.start}–${s.end}${title}`;
  };

  app.post("/api/swaps", requireAuth(config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { fromShiftId?: number; toShiftId?: number; message?: string };
    if (typeof body.fromShiftId !== "number" || typeof body.toShiftId !== "number") return c.json({ error: "fromShiftId and toShiftId required" }, 400);
    if (body.message !== undefined && (typeof body.message !== "string" || body.message.length > 500)) return c.json({ error: "invalid_message" }, 400);
    const res = createSwap(db, { fromEmployeeId: c.get("auth").employeeId, fromShiftId: body.fromShiftId, toShiftId: body.toShiftId, message: body.message });
    if (!res.ok) return c.json({ error: res.reason }, 400);
    if (bot) {
      const tg = tgOf(res.counterpartyId);
      if (tg != null) {
        const fromName = nameOf(res.request.fromEmployeeId) ?? "Коллега";
        const text = `«${fromName} предлагает обмен: отдаёт ${shiftLineOf(res.request.fromShiftId)}, хочет твою ${shiftLineOf(res.request.toShiftId)}»`;
        await notifySwapProposal(bot, tg, res.request.id, text);
      }
    }
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

  app.post("/api/admin/distribute", requireAdmin(config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { from?: unknown; to?: unknown; apply?: unknown };
    if (typeof body.from !== "string" || typeof body.to !== "string") {
      return c.json({ error: "from and to are required" }, 400);
    }
    const { assignments } = buildDistribution(db, body.from, body.to);
    if (body.apply === true) {
      applyDistribution(db, assignments.map((a) => ({ shiftId: a.shiftId, employeeId: a.employeeId })));
    }
    return c.json({ applied: body.apply === true, assignments });
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

  // --- Weekend-work marketplace ---------------------------------------------

  // Worker: browse open vacant slots (with "am I interested?" flag)
  app.get("/api/weekend/slots", requireAuth(config.jwtSecret), (c) => {
    const from = c.req.query("from") ?? teamNow(config.teamTz).date;
    return c.json({ slots: openSlotsForWorker(db, c.get("auth").employeeId, from) });
  });

  // Worker: express interest in a slot (idempotent)
  app.post("/api/weekend/slots/:id/interest", requireAuth(config.jwtSecret), (c) => {
    const res = expressInterest(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!res.ok) return c.json({ error: res.reason }, 400);
    return c.json({ ok: true }, 201);
  });

  // Worker: my offered/confirmed weekend assignments
  app.get("/api/weekend/offers", requireAuth(config.jwtSecret), (c) =>
    c.json({ offers: myOffers(db, c.get("auth").employeeId) }),
  );

  // Worker: confirm an offer -> creates a weekend_work shift
  app.post("/api/weekend/offers/:id/confirm", requireAuth(config.jwtSecret), async (c) => {
    const res = confirmOffer(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!res.ok) return c.json({ error: res.reason }, 400);
    if (bot) await notifyAdmins(bot, db, "Работник подтвердил работу в выходной ✅");
    return c.json({ ok: true });
  });

  // Worker: decline an offer -> slot reopens
  app.post("/api/weekend/offers/:id/decline", requireAuth(config.jwtSecret), async (c) => {
    const res = declineOffer(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!res.ok) return c.json({ error: res.reason }, 400);
    if (bot) await notifyAdmins(bot, db, "Работник отказался от работы в выходной.");
    return c.json({ ok: true });
  });

  // Admin: post a new vacant slot
  app.post("/api/admin/weekend/slots", requireAdmin(config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      date?: unknown; start?: unknown; end?: unknown; title?: unknown; location?: unknown; note?: unknown;
    };
    if (typeof body.date !== "string" || typeof body.start !== "string" || typeof body.end !== "string") {
      return c.json({ error: "date, start and end are required" }, 400);
    }
    // Assigning a slot writes a weekend_work entry, so a weekday slot could never
    // produce a coherent one — reject it here rather than at assign time.
    if (!isWeekend(body.date)) {
      return c.json({ error: "Вакантный день может быть только субботой или воскресеньем" }, 400);
    }
    const slot = postSlot(db, {
      date: body.date,
      start: body.start,
      end: body.end,
      title: typeof body.title === "string" ? body.title : null,
      location: typeof body.location === "string" ? body.location : null,
      note: typeof body.note === "string" ? body.note : null,
    });
    if (bot) await notifyVacantSlot(bot, db, slot.id, `Нужен человек на выходной:\n${slotLineOf(slot)}\n\nНажми «Хочу», если готов выйти.`);
    return c.json({ slot }, 201);
  });

  // Admin: open slots with their ranked interested list (fairness hint: confirmedThisMonth asc)
  app.get("/api/admin/weekend/slots", requireAdmin(config.jwtSecret), (c) => {
    const from = c.req.query("from") ?? teamNow(config.teamTz).date;
    const slots = listOpenSlots(db, from).map((slot) => ({
      slot,
      interested: interestedForSlot(db, slot.id),
      assignees: assigneesForSlot(db, slot.id),
    }));
    return c.json({ slots });
  });

  // Admin: assign a slot to an interested worker -> creates an offered assignment
  app.post("/api/admin/weekend/slots/:id/assign", requireAdmin(config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { employeeId?: unknown };
    if (typeof body.employeeId !== "number") return c.json({ error: "employeeId is required" }, 400);
    const res = assignSlot(db, Number(c.req.param("id")), body.employeeId);
    if (!res.ok) return c.json({ error: res.reason }, 400);
    if (bot) {
      const tg = tgOf(body.employeeId);
      const slot = getVacantSlot(db, res.assignment.slotId);
      if (tg != null && slot) {
        await notifyWeekendOffer(bot, tg, res.assignment.id, `Тебе предложили работу в выходной:\n${slotLineOf(slot)}\n\nПодтвердишь?`);
      }
    }
    return c.json({ assignment: res.assignment }, 201);
  });

  // Admin: take someone off a slot (also removes their schedule entry).
  app.post("/api/admin/weekend/assignments/:id/unassign", requireAdmin(config.jwtSecret), async (c) => {
    const res = unassign(db, Number(c.req.param("id")));
    if (!res.ok) return c.json({ error: res.reason }, 400);
    return c.json({ ok: true });
  });

  // Admin: payroll rows for confirmed weekend work in a date range
  app.get("/api/admin/weekend/payroll", requireAdmin(config.jwtSecret), (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) return c.json({ error: "from and to are required" }, 400);
    return c.json({ rows: payrollRows(db, from, to) });
  });

  // Admin: same payroll as a downloadable CSV (BOM-prefixed for Excel/Cyrillic)
  app.get("/api/admin/weekend/payroll.csv", requireAdmin(config.jwtSecret), (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) return c.json({ error: "from and to are required" }, 400);
    const csv = payrollCsv(payrollRows(db, from, to));
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="weekend-payroll-${from}_${to}.csv"`);
    return c.body("﻿" + csv);
  });

  return app;
}
