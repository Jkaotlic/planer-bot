import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { Bot } from "grammy";
import type { Db } from "../db/client";
import type { Config } from "../config";
import { validateInitData, type TelegramUser } from "../auth/telegram";
import { issueToken } from "../auth/jwt";
import { requireAuth, requireAdmin, type Env } from "./middleware";
import { securityHeaders } from "./security-headers";
import { rateLimiter } from "./rate-limit";
import { listActiveTemplates } from "../repo/templates";
import { readTeamSchedule } from "../repo/team-schedule";
import { getAllTemplateRoles, setTemplateRoles, rotationCandidatesFor, setRotationUnit, UnknownEmployeesError } from "../repo/template-roles";
import { createShift, updateShift, deleteShift, getShift, listUpcomingForEmployee, listShiftsInRange, listShiftsOverlapping } from "../repo/shifts";
import type { Shift, SwapRequest } from "../db/schema";
import {
  getByTelegramId,
  getEmployeeById,
  createAdminEmployee,
  createEmployee,
  listActive,
  listForAdmin,
  archiveEmployee,
  restoreEmployee,
  setEmployeeAdmin,
  countActiveAdmins,
  renameEmployee,
  findActiveByDisplayName,
  reorderEmployee,
  setBirthDate,
  setInviteToken,
  setRemindersEnabled,
  setPreferredName,
  rememberTelegramProfile,
} from "../repo/employees";
import { createEntrySchema, updateEntrySchema, entryTimesError, entryDateError, entryRangeError } from "./entry-schema";
import { createSwap, acceptSwap, declineSwap, cancelSwap } from "../swap/swap-service";
import { notifyEntryChange, notifyScheduleChange, withScheduleDiff } from "../schedule/change-notice";
import { listSwapsForEmployee, listPendingSwapsForShift } from "../repo/swaps";
import { listRecentAudit, recordAudit, queryAudit } from "../repo/audit";
import {
  notifyUser,
  notifyAdmins,
  notifySwapProposal,
  notifyVacantSlot,
  notifyWeekendOffer,
  swapAcceptedText,
  swapDeclinedText,
  swapAcceptedAdminText,
  swapAutoCancelledText,
  swapExpiredText,
  weekendConfirmedAdminText,
  weekendDeclinedAdminText,
  weekendUnassignedText,
} from "../bot/notify";
import {
  shiftLineOf as shiftLineOfDb,
  slotLineOf,
  nameOf as nameOfDb,
  swapAuditPayload as swapAuditPayloadDb,
} from "../util/message-lines";
import { teamNow } from "../util/team-time";
import {
  isWeekend,
  isAbsence,
  countsForBalance,
  dateStr,
  timeStr,
  dayNumber,
  rotationQueue,
  describeTurn,
  isBirthDate,
  addressOf,
  normalizePreferredName,
  PREFERRED_NAME_MAX,
} from "@planer/shared";
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
import { listOpenSlots, getVacantSlot, findOpenSlotLike } from "../repo/weekend";
import { applyRosterImport, buildRosterCsv, RosterImportConflictError, type PersonResolution } from "../roster/roster-service";
import { decodeRoster, parseRosterCsv } from "../roster/roster-codec";
import { buildShiftCountsReport, shiftCountsCsv } from "../reports/shift-counts";
import {
  upcomingBirthdays,
  previewCampaign,
  updateCampaign,
  ensureCampaign,
  listAllCampaigns,
  teamRecipients,
  markSent,
} from "../birthdays/birthday-service";

export interface AppDeps {
  db: Db;
  config: Config;
  bot?: Bot;
}

function displayNameOf(u: TelegramUser): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return name || u.username || "Без имени";
}

/** Said at every door that could put two identical ФИО in the active list. Names the
 *  row already holding it, because the fix is to rename one of the two. */
function nameTakenError(taken: string): string {
  return `«${taken}» уже есть в списке. График файлом сверяется по ФИО, поэтому двух одинаковых быть не может — ` +
    `добавьте отчество или инициал, чтобы их было видно врозь.`;
}

export function createApp(deps: AppDeps): Hono<Env> {
  const { db, config, bot } = deps;
  const app = new Hono<Env>();

  /**
   * Кампании ДР, для которых прямо сейчас идёт рассылка.
   *
   * `previewCampaign`'s `blocker` смотрит на статус `sent`, а он ставится только
   * ПОСЛЕ цикла `await notifyUser(...)` на каждого получателя — то есть между
   * чтением блокера и записью статуса лежит настоящее окно на секунды. Два
   * одновременных «Разослать» (двойной тап, два открытых админом устройства, повтор
   * сети) оба проходят проверку и оба шлют всей команде — «задвоенное поздравление
   * хуже недосланного», как и говорит комментарий у `markSent`, но раньше это не
   * было ничем защищено. Клеймится синхронно, до первого `await`, поэтому окна для
   * второго запроса нет — тот же принцип, что у `status !== "pending"` в обменах.
   */
  const birthdaySending = new Set<number>();

  // Registered first (= outermost) so it runs for every response this process
  // serves, including the static /app and /admin bundles mounted later in
  // index.ts — Hono composes "*" middleware around whatever else is
  // registered on the same app instance, regardless of registration order
  // relative to those routes.
  app.use("*", securityHeaders());

  // Coarse flood protection for the whole app — see rate-limit.ts for keying
  // details and why the numbers are sized as a shared ceiling rather than a
  // strict per-visitor budget.
  //
  // Sized against the actual worst realistic minute, not a guess: opening the
  // mini app fires 7 requests (getMe + 6 parallel — see miniapp/src/App.tsx's
  // bootstrap effect), and every tab switch / refocus fires 6 more
  // (reloadData). Shift reminders go out after 20:00 and predictably cause
  // several people to open the app within the same minute — the worst
  // plausible cluster today is the whole 30-person team, each bootstrapping
  // and switching tabs at least once: 30 × (7 + 6) = 390 req/min. Sized for
  // roughly double that headcount (team growth): 60 × 13 = 780 req/min. The
  // limit below is >10x that grown worst case (~20x today's), while still
  // capping a real flood — which runs orders of magnitude higher than
  // this, not a few percent higher — well short of anything that could
  // bother the same process's Telegram long-poll. See the hardening report
  // for the full arithmetic.
  app.use("*", rateLimiter({ windowMs: 60_000, max: 8_000 }));

  // API responses are live data — never let a browser / Telegram webview serve
  // a cached copy, or an admin's edits won't show up until the app is reopened.
  app.use("/api/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  // Defence in depth: everything under /api/admin/* is admin-only by construction,
  // so a route that forgets its inline requireAdmin still can't leak. The per-route
  // guards below stay as belt-and-suspenders.
  app.use("/api/admin/*", requireAdmin(db, config.jwtSecret));

  app.onError((err, c) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (/FOREIGN KEY/i.test(msg)) return c.json({ error: "invalid_reference" }, 400);
    console.error("unhandled error:", err);
    return c.json({ error: "internal" }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  // Tighter budget than the app-wide limiter above — this endpoint is
  // normally called once per session (the frontend caches the token it gets
  // back) — but "tight" still has to swallow the whole team logging in at
  // once, since that's exactly what happens right after an evening reminder.
  // Worst realistic minute: the grown ~60-person team (see above), each
  // allowed one retry for a flaky connection or an impatient re-tap — 60 × 2
  // = 120 req/min. The limit below is >10x that, and still a full order of
  // magnitude below the app-wide ceiling, so a login-flood specifically is
  // caught well before it could ever touch the general budget.
  app.post("/api/auth", rateLimiter({ windowMs: 60_000, max: 1_200 }), async (c) => {
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
    if (employee && !employee.isActive) {
      // An archived worker stays locked out — that's the point of archiving. But
      // ADMIN_TELEGRAM_IDS lives in server/.env, outside this database: an operator
      // who put a Telegram id there already trusts it more than anything the app's own
      // admin UI can grant. So being archived — even as the team's last admin, which
      // the guards below now prevent but a direct DB edit still could — must not be a
      // dead end for someone on that list the way it rightly is for everyone else.
      // Re-authenticating undoes the archive rather than re-issuing a token for a row
      // marked inactive.
      if (!allowlisted) return c.json({ error: "not_registered" }, 403);
      employee = restoreEmployee(db, employee.id)!;
      if (!employee.isAdmin) employee = setEmployeeAdmin(db, employee.id, true) ?? employee;
      recordAudit(db, "employee_restored", employee.id, {
        employeeId: employee.id,
        displayName: employee.displayName,
        via: "allowlist_reauth",
      });
    }
    if (!employee) {
      if (!allowlisted) return c.json({ error: "not_registered" }, 403);
      employee = createAdminEmployee(db, {
        telegramUserId: user.id,
        tgUsername: user.username,
        tgFirstName: user.firstName,
        displayName: displayNameOf(user),
      });
    }
    // People rename themselves in Telegram, and `tgFirstName` is what the bot
    // greets them with — refresh it here rather than freezing it at link time.
    rememberTelegramProfile(db, employee.id, { tgUsername: user.username, tgFirstName: user.firstName });
    // ADMIN_TELEGRAM_IDS means admin — that is its only meaning, and every other
    // branch here already acts on it: a new allowlisted person is created as an
    // admin, an archived one is restored and promoted. An *active* worker already
    // in the database was the one case left out: the response said `isAdmin: true`
    // while the row said otherwise, and `requireAdmin` reads the row — so the app
    // showed them the admin tabs and 403'd every request behind them.
    if (allowlisted && !employee.isAdmin) {
      employee = setEmployeeAdmin(db, employee.id, true) ?? employee;
      recordAudit(db, "employee_admin_changed", employee.id, {
        employeeId: employee.id,
        displayName: employee.displayName,
        isAdmin: true,
        via: "allowlist",
      });
    }
    const token = await issueToken({ employeeId: employee.id, isAdmin: employee.isAdmin }, config.jwtSecret);
    return c.json({ token, employee: { id: employee.id, displayName: employee.displayName, isAdmin: employee.isAdmin } });
  });

  app.get("/api/me", requireAuth(db, config.jwtSecret), (c) => {
    const me = getEmployeeById(db, c.get("auth").employeeId);
    if (!me) return c.json({ error: "not_found" }, 404);
    return c.json({
      id: me.id,
      displayName: me.displayName,
      // What to say hello with. The roster's «Фамилия Имя» is for lists, not for
      // greetings — see `addressOf`.
      address: addressOf(me),
      /** What they typed into «Как ко мне обращаться», so the field can show it. */
      preferredName: me.preferredName,
      isAdmin: c.get("auth").isAdmin,
      remindersEnabled: me.remindersEnabled,
    });
  });

  /** The settings a worker owns about themselves. Scoped to the caller by the
   *  token: there is no employee id in the path, so nobody can touch anybody else.
   *  A patch, not a form — the two fields live on different screens and are saved
   *  by different gestures, so either may arrive alone. */
  app.patch("/api/me/settings", requireAuth(db, config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { remindersEnabled?: unknown; preferredName?: unknown };
    const hasReminders = body.remindersEnabled !== undefined;
    const hasPreferred = body.preferredName !== undefined;
    if (!hasReminders && !hasPreferred) return c.json({ error: "нечего сохранять" }, 400);
    if (hasReminders && typeof body.remindersEnabled !== "boolean") {
      return c.json({ error: "remindersEnabled должен быть true или false" }, 400);
    }
    const preferred = hasPreferred ? normalizePreferredName(body.preferredName) : null;
    if (preferred && !preferred.ok) {
      return c.json({ error: `Обращение — не длиннее ${PREFERRED_NAME_MAX} символов` }, 400);
    }

    const id = c.get("auth").employeeId;
    let employee = getEmployeeById(db, id);
    if (!employee) return c.json({ error: "not_found" }, 404);
    if (hasReminders) employee = setRemindersEnabled(db, id, body.remindersEnabled as boolean) ?? employee;
    if (preferred?.ok) employee = setPreferredName(db, id, preferred.value) ?? employee;

    return c.json({
      remindersEnabled: employee.remindersEnabled,
      preferredName: employee.preferredName,
      // Returned so the greeting can update without a second round trip.
      address: addressOf(employee),
    });
  });

  app.get("/api/templates", requireAuth(db, config.jwtSecret), (c) => c.json({ templates: listActiveTemplates(db) }));

  app.get("/api/my/shifts", requireAuth(db, config.jwtSecret), (c) => {
    const from = c.req.query("from") ?? new Intl.DateTimeFormat("en-CA", { timeZone: config.teamTz }).format(new Date());
    return c.json({ shifts: listUpcomingForEmployee(db, c.get("auth").employeeId, from) });
  });

  app.get("/api/team/schedule", requireAuth(db, config.jwtSecret), (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) return c.json({ error: "from and to are required" }, 400);
    if (!dateStr.safeParse(from).success || !dateStr.safeParse(to).success) {
      return c.json({ error: "from and to must be valid YYYY-MM-DD dates" }, 400);
    }
    if (from > to) return c.json({ error: "from must not be after to" }, 400);
    if (dayNumber(to) - dayNumber(from) > 30) {
      return c.json({ error: "the range must span at most 31 days" }, 400);
    }
    // Формой ответа заведует repo/team-schedule: тем же шейпером сервер строит
    // картинку недели для бота, и расходиться они не должны.
    return c.json(readTeamSchedule(db, from, to));
  });

  app.get("/api/employees", requireAuth(db, config.jwtSecret), (c) =>
    c.json({ employees: listActive(db).map((e) => ({ id: e.id, displayName: e.displayName })) }),
  );

  // `address` is computed, not stored: the admin card shows what the bot will
  // actually say, so it is obvious whose greeting still needs setting.
  app.get("/api/admin/employees", requireAdmin(db, config.jwtSecret), (c) =>
    c.json({ employees: listForAdmin(db).map((employee) => ({ ...employee, address: addressOf(employee) })) }));

  app.post("/api/admin/employees", requireAdmin(db, config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { displayName?: unknown };
    if (typeof body.displayName !== "string" || body.displayName.trim().length === 0) {
      return c.json({ error: "displayName is required" }, 400);
    }
    const clash = findActiveByDisplayName(db, body.displayName);
    if (clash) return c.json({ error: nameTakenError(clash.displayName) }, 409);
    const inviteToken = randomBytes(16).toString("hex");
    const employee = createEmployee(db, { displayName: body.displayName, inviteToken });
    const inviteLink = config.botUsername ? `https://t.me/${config.botUsername}?start=${inviteToken}` : null;
    return c.json({ employee, inviteToken, inviteLink }, 201);
  });

  // Rename a worker, and/or set their birthday. Either field on its own is a
  // valid edit; sending neither is not, so an empty body can't silently no-op.
  app.patch("/api/admin/employees/:id", requireAdmin(db, config.jwtSecret), async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { displayName?: unknown; birthDate?: unknown; preferredName?: unknown };
    const hasName = body.displayName !== undefined;
    const hasBirthday = body.birthDate !== undefined;
    const hasPreferred = body.preferredName !== undefined;
    if (!hasName && !hasBirthday && !hasPreferred) return c.json({ error: "displayName is required" }, 400);

    if (hasName && (typeof body.displayName !== "string" || body.displayName.trim().length === 0)) {
      return c.json({ error: "displayName is required" }, 400);
    }
    // null clears it — nobody is obliged to give a birthday.
    if (hasBirthday && body.birthDate !== null && (typeof body.birthDate !== "string" || !isBirthDate(body.birthDate))) {
      return c.json({ error: "birthDate должен быть в виде ММ-ДД, например 05-08" }, 400);
    }
    const preferred = hasPreferred ? normalizePreferredName(body.preferredName) : null;
    if (preferred && !preferred.ok) {
      return c.json({ error: `Обращение — не длиннее ${PREFERRED_NAME_MAX} символов` }, 400);
    }

    let employee = getEmployeeById(db, id);
    if (!employee) return c.json({ error: "not_found" }, 404);
    if (hasName) {
      const clash = findActiveByDisplayName(db, body.displayName as string, id);
      if (clash) return c.json({ error: nameTakenError(clash.displayName) }, 409);
    }
    if (hasName) employee = renameEmployee(db, id, (body.displayName as string).trim()) ?? employee;
    if (hasBirthday) employee = setBirthDate(db, id, body.birthDate as string | null) ?? employee;
    if (preferred?.ok) employee = setPreferredName(db, id, preferred.value) ?? employee;

    recordAudit(db, "employee_updated", c.get("auth").employeeId, {
      employeeId: id,
      displayName: employee.displayName,
      ...(hasBirthday ? { birthDate: employee.birthDate } : {}),
      ...(hasPreferred ? { preferredName: employee.preferredName } : {}),
    });
    return c.json({ employee: { ...employee, address: addressOf(employee) } });
  });

  // Move a worker to a position in the list. The number is what the admin sees
  // (1 = first), and the server renumbers everyone so the column stays contiguous.
  app.post("/api/admin/employees/:id/order", requireAdmin(db, config.jwtSecret), async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { position?: unknown };
    if (typeof body.position !== "number" || !Number.isFinite(body.position)) {
      return c.json({ error: "position (number) required" }, 400);
    }
    const before = getEmployeeById(db, id);
    const employees = reorderEmployee(db, id, body.position);
    if (!employees) return c.json({ error: "not_found" }, 404);
    const after = employees.find((employee) => employee.id === id)!;
    recordAudit(db, "employee_reordered", c.get("auth").employeeId, {
      employeeId: id,
      displayName: after.displayName,
      from: before?.rosterOrder ?? null,
      to: after.rosterOrder,
    });
    return c.json({ employees });
  });

  // Guarded exactly like the /role demote below: archiving an admin reaches the same
  // "no active admin left" dead end, and — unlike a demote — there is no undo button
  // for it anywhere in the app.
  app.post("/api/admin/employees/:id/archive", requireAdmin(db, config.jwtSecret), (c) => {
    const id = Number(c.req.param("id"));
    const target = getEmployeeById(db, id);
    if (!target) return c.json({ error: "not_found" }, 404);
    if (target.isAdmin && countActiveAdmins(db) <= 1) {
      return c.json({ error: "last_admin" }, 400);
    }
    const employee = archiveEmployee(db, id, teamNow(config.teamTz).date);
    if (!employee) return c.json({ error: "not_found" }, 404);
    recordAudit(db, "employee_archived", c.get("auth").employeeId, { employeeId: id, displayName: employee.displayName });
    return c.json({ ok: true });
  });

  app.post("/api/admin/employees/:id/restore", requireAdmin(db, config.jwtSecret), (c) => {
    const id = Number(c.req.param("id"));
    // While he was in the archive somebody took his ФИО. Bringing him back would put
    // two identical rows in the roster export — say so instead, and let the admin
    // decide which of the two gets renamed.
    const archived = getEmployeeById(db, id);
    if (archived) {
      const clash = findActiveByDisplayName(db, archived.displayName, id);
      if (clash) return c.json({ error: nameTakenError(clash.displayName) }, 409);
    }
    const employee = restoreEmployee(db, id);
    if (!employee) return c.json({ error: "not_found" }, 404);
    recordAudit(db, "employee_restored", c.get("auth").employeeId, { employeeId: id, displayName: employee.displayName });
    return c.json({ ok: true });
  });

  // Promote a worker to admin, or remove admin rights. Guarded so the team
  // can never demote its last admin and lock everyone out.
  app.post("/api/admin/employees/:id/role", requireAdmin(db, config.jwtSecret), async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { isAdmin?: unknown };
    if (typeof body.isAdmin !== "boolean") return c.json({ error: "isAdmin (boolean) required" }, 400);
    const target = getEmployeeById(db, id);
    if (!target) return c.json({ error: "not_found" }, 404);
    // Раньше: демоут архивного админа мог упереться в last_admin по чужой
    // причине (countActiveAdmins их не считает — реальному последнему активному
    // админу ничего не грозило), а промоут архивного в админы проходил
    // безусловно — запись в никуда, войти он всё равно не мог. Та же проверка,
    // что уже стоит у записей и распределения: с архивным целевым человеком
    // ничего не меняем, пока его не восстановили.
    if (!target.isActive) {
      return c.json({ error: `«${target.displayName}» в архиве — восстановите его, прежде чем менять права` }, 400);
    }
    if (!body.isAdmin && target.isAdmin && countActiveAdmins(db) <= 1) {
      return c.json({ error: "last_admin" }, 400);
    }
    const employee = setEmployeeAdmin(db, id, body.isAdmin);
    recordAudit(db, "employee_admin_changed", c.get("auth").employeeId, {
      employeeId: id,
      displayName: employee?.displayName ?? target.displayName,
      isAdmin: body.isAdmin,
    });
    return c.json({ employee });
  });

  // (Re)issue an invite link for a worker who hasn't linked their Telegram yet —
  // lets an admin re-show the link or replace a broken/lost one. `regenerate`
  // forces a fresh token (invalidating any previously shared link).
  app.post("/api/admin/employees/:id/invite", requireAdmin(db, config.jwtSecret), async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { regenerate?: unknown };
    const emp = getEmployeeById(db, id);
    if (!emp) return c.json({ error: "not_found" }, 404);
    if (emp.telegramUserId != null) return c.json({ error: "already_linked" }, 400);
    // An archived row can't be claimed (see `linkTelegramAccount`), so handing out a
    // link for one is handing out a dead end. Restore them first.
    if (!emp.isActive) return c.json({ error: "archived" }, 400);
    let inviteToken = emp.inviteToken;
    if (!inviteToken || body.regenerate === true) {
      inviteToken = randomBytes(16).toString("hex");
      setInviteToken(db, id, inviteToken);
    }
    const inviteLink = config.botUsername ? `https://t.me/${config.botUsername}?start=${inviteToken}` : null;
    return c.json({ inviteToken, inviteLink });
  });

  app.get("/api/admin/events", requireAdmin(db, config.jwtSecret), (c) => {
    const events = listRecentAudit(db, 30).map((row) => ({
      id: row.id,
      type: row.type,
      createdAt: row.createdAt,
      actorName: row.actorEmployeeId != null ? (getEmployeeById(db, row.actorEmployeeId)?.displayName ?? null) : null,
      payload: row.payload,
    }));
    return c.json({ events });
  });

  // --- Дни рождения ---------------------------------------------------------
  // The bot never mails the team on its own. It nudges admins a week ahead; every
  // message after that is an admin pressing a button, having seen exactly what
  // will go out and to whom.

  const birthdayAsOf = (c: { req: { query(name: string): string | undefined } }) =>
    c.req.query("asOf") ?? teamNow(config.teamTz).date;

  app.get("/api/admin/birthdays", requireAdmin(db, config.jwtSecret), (c) => {
    const asOf = birthdayAsOf(c);
    if (!dateStr.safeParse(asOf).success) return c.json({ error: "asOf must be a valid YYYY-MM-DD date" }, 400);
    return c.json({ asOf, birthdays: upcomingBirthdays(db, asOf) });
  });

  /** Every round ever prepared — the ones already sent included. Separate from
   *  `/birthdays` because that one looks forward and this one looks back. */
  app.get("/api/admin/birthdays/campaigns", requireAdmin(db, config.jwtSecret), (c) =>
    c.json({ campaigns: listAllCampaigns(db) }));

  app.get("/api/admin/birthdays/:id/preview", requireAdmin(db, config.jwtSecret), (c) => {
    const asOf = birthdayAsOf(c);
    if (!dateStr.safeParse(asOf).success) return c.json({ error: "asOf must be a valid YYYY-MM-DD date" }, 400);
    const preview = previewCampaign(db, Number(c.req.param("id")), asOf);
    if (!preview) return c.json({ error: "not_found" }, 404);
    return c.json(preview);
  });

  app.put("/api/admin/birthdays/:id", requireAdmin(db, config.jwtSecret), async (c) => {
    const asOf = birthdayAsOf(c);
    if (!dateStr.safeParse(asOf).success) return c.json({ error: "asOf must be a valid YYYY-MM-DD date" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { collectUrl?: unknown; messageText?: unknown; scheduledSendOn?: unknown };

    const patch: { collectUrl?: string | null; messageText?: string | null; scheduledSendOn?: string | null } = {};
    if (body.collectUrl !== undefined) {
      if (body.collectUrl !== null && typeof body.collectUrl !== "string") {
        return c.json({ error: "collectUrl должен быть ссылкой или null" }, 400);
      }
      const url = typeof body.collectUrl === "string" ? body.collectUrl.trim() : null;
      // Only http(s) — the link is forwarded to the whole team, so a `javascript:`
      // or a bare word must not be able to travel in a message from the bot.
      if (url && !/^https?:\/\/\S+$/i.test(url)) {
        return c.json({ error: "Ссылка должна начинаться с http:// или https://" }, 400);
      }
      patch.collectUrl = url || null;
    }
    if (body.messageText !== undefined) {
      if (body.messageText !== null && typeof body.messageText !== "string") {
        return c.json({ error: "messageText должен быть текстом или null" }, 400);
      }
      const text = typeof body.messageText === "string" ? body.messageText.trim() : null;
      if (text && text.length > 3000) return c.json({ error: "Текст длиннее 3000 символов" }, 400);
      patch.messageText = text || null;
    }
    if (body.scheduledSendOn !== undefined) {
      if (body.scheduledSendOn === null) {
        patch.scheduledSendOn = null;
      } else if (typeof body.scheduledSendOn !== "string" || !dateStr.safeParse(body.scheduledSendOn).success) {
        return c.json({ error: "Дата напоминания должна быть в виде ГГГГ-ММ-ДД" }, 400);
      } else {
        // Read the round before validating: a client that resends this field
        // unchanged on every save (the miniapp does) must not get stuck the
        // moment the reminder day is behind us but the birthday isn't —
        // resubmitting the round's own stored value is not an edit.
        const round = ensureCampaign(db, Number(c.req.param("id")), asOf);
        if (!round) return c.json({ error: "not_found" }, 404);
        // The window is «from today up to and including the birthday». Earlier is
        // already gone; later is a reminder to send a collection for a party that
        // has happened.
        if (body.scheduledSendOn !== round.scheduledSendOn && body.scheduledSendOn < asOf) {
          return c.json({ error: "Дата напоминания уже прошла" }, 400);
        }
        if (body.scheduledSendOn > round.celebratedOn) {
          return c.json({ error: "Напоминать после самого дня рождения уже поздно" }, 400);
        }
        patch.scheduledSendOn = body.scheduledSendOn;
      }
    }
    if (Object.keys(patch).length === 0) return c.json({ error: "нечего сохранять" }, 400);

    const campaign = updateCampaign(db, Number(c.req.param("id")), asOf, patch);
    if (!campaign) return c.json({ error: "not_found" }, 404);
    return c.json({ campaign });
  });

  /** Sends the collection to the team. Needs an explicit confirmation in the body:
   *  this is the one call in the app that messages every colleague at once. */
  app.post("/api/admin/birthdays/:id/send", requireAdmin(db, config.jwtSecret), async (c) => {
    const asOf = birthdayAsOf(c);
    if (!dateStr.safeParse(asOf).success) return c.json({ error: "asOf must be a valid YYYY-MM-DD date" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { confirm?: unknown };
    if (body.confirm !== true) return c.json({ error: "нужно подтверждение: confirm: true" }, 400);

    const employeeId = Number(c.req.param("id"));
    const preview = previewCampaign(db, employeeId, asOf);
    if (!preview) return c.json({ error: "not_found" }, 404);
    if (preview.blocker) return c.json({ error: preview.blocker }, 409);
    if (!bot) return c.json({ error: "Бот не запущен — рассылка недоступна" }, 503);

    const campaign = ensureCampaign(db, employeeId, asOf)!;
    // Клейм синхронный: между этой строкой и первым `await` ниже другому запросу
    // некуда вклиниться (сингл-тредный Node), так что второй одновременный «Разослать»
    // всегда видит кампанию уже занятой.
    if (birthdaySending.has(campaign.id)) return c.json({ error: "Рассылка уже идёт." }, 409);
    birthdaySending.add(campaign.id);
    try {
      let delivered = 0;
      for (const recipient of teamRecipients(db, employeeId)) {
        if (await notifyUser(bot, recipient.telegramUserId!, preview.message)) delivered += 1;
      }
      // «Разослано» закрывает кнопку навсегда (`blocker`: «повторная отправка
      // отключена»), поэтому ставится, только если сообщение дошло хоть до кого-то.
      // Ноль доставленных — это не рассылка, а её отсутствие: Telegram ответил 429
      // всей пачке или сеть отвалилась, и запирать единственную кнопку не за что.
      // Никого не задваиваем — до людей ничего не дошло. Как только дошло хотя бы до
      // одного, повтор снова закрыт: задвоенное поздравление хуже недосланного.
      if (delivered > 0) markSent(db, campaign.id, delivered, new Date());
      recordAudit(db, "birthday_sent", c.get("auth").employeeId, {
        employeeId,
        displayName: preview.displayName,
        delivered,
        intended: preview.recipients.length,
      });
      return c.json({ delivered, intended: preview.recipients.length });
    } finally {
      birthdaySending.delete(campaign.id);
    }
  });

  /** The full «кто когда что менял» history: filtered by type and date, paged. */
  app.get("/api/admin/journal", requireAdmin(db, config.jwtSecret), (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    for (const [label, value] of [["from", from], ["to", to]] as const) {
      if (value && !dateStr.safeParse(value).success) {
        return c.json({ error: `${label} must be a valid YYYY-MM-DD date` }, 400);
      }
    }
    if (from && to && from > to) return c.json({ error: "from must not be after to" }, 400);

    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
    const types = (c.req.query("types") ?? "").split(",").map((t) => t.trim()).filter(Boolean);

    const actorParam = c.req.query("actor");
    let actorEmployeeId: number | undefined;
    if (actorParam !== undefined) {
      if (actorParam.trim() === "" || !Number.isFinite(Number(actorParam))) {
        return c.json({ error: "actor must be a number" }, 400);
      }
      actorEmployeeId = Number(actorParam);
    }

    const page = queryAudit(db, { types, from, to, limit, offset, actorEmployeeId });
    return c.json({
      total: page.total,
      limit,
      offset,
      availableTypes: page.availableTypes,
      availableActors: page.availableActors,
      events: page.rows.map((row) => ({
        id: row.id,
        type: row.type,
        createdAt: row.createdAt,
        actorName: row.actorEmployeeId != null ? (getEmployeeById(db, row.actorEmployeeId)?.displayName ?? null) : null,
        payload: row.payload,
      })),
    });
  });

  /** «Кто сколько отдежурил» — people × kinds over a period. */
  app.get("/api/admin/reports/shift-counts", requireAdmin(db, config.jwtSecret), (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    const err = rangeError(from, to, 366);
    if (err) return c.json({ error: err }, 400);
    return c.json(buildShiftCountsReport(db, from!, to!));
  });

  app.get("/api/admin/reports/shift-counts.csv", requireAdmin(db, config.jwtSecret), (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    const err = rangeError(from, to, 366);
    if (err) return c.json({ error: err }, 400);
    const csv = shiftCountsCsv(buildShiftCountsReport(db, from!, to!));
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="shift-counts-${from}_${to}.csv"`);
    return c.body("﻿" + csv);
  });

  /** The fields worth keeping in the audit feed — enough to answer «что именно поменяли»
   *  without copying the whole row into the log. */
  const auditShape = (s: Shift) => ({
    entryId: s.id, employeeId: s.employeeId, date: s.date, endDate: s.endDate,
    category: s.category, title: s.title, start: s.start, end: s.end,
  });

  /**
   * The target of a schedule edit, when there is one, has to still be on staff.
   *
   * The middleware guards the ACTOR — an active admin — and nothing looked at whom
   * they were writing about. An entry on an archived person is invisible the moment
   * it exists: `/api/team/schedule` filters those rows out and both grids draw their
   * people from that same response, so the admin got a cheerful 201 for a write that
   * shows up nowhere. Same rule the weekend market already carries, same place: at
   * the decision, not only at the door. `null` is fine — a vacant entry belongs to
   * nobody by design.
   */
  const archivedTargetError = (employeeId: number | null | undefined): string | null => {
    if (employeeId == null) return null;
    const target = getEmployeeById(db, employeeId);
    if (!target) return null; // the foreign key answers this one, as `invalid_reference`
    return target.isActive ? null : `«${target.displayName}» в архиве — восстановите его, прежде чем ставить записи`;
  };

  app.post("/api/admin/entries", requireAdmin(db, config.jwtSecret), async (c) => {
    const parsed = createEntrySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    const archived = archivedTargetError(parsed.data.employeeId);
    if (archived) return c.json({ error: archived }, 400);
    const entry = createShift(db, parsed.data);
    recordAudit(db, "entry_created", c.get("auth").employeeId, auditShape(entry));
    const notified = await notifyEntryChange(db, bot, {
      actorEmployeeId: c.get("auth").employeeId, before: null, after: entry, now: teamNow(config.teamTz),
    });
    return c.json({ entry, notified }, 201);
  });

  app.patch("/api/admin/entries/:id", requireAdmin(db, config.jwtSecret), async (c) => {
    const id = Number(c.req.param("id"));
    const parsed = updateEntrySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    const existing = getShift(db, id);
    if (!existing) return c.json({ error: "not_found" }, 404);
    const archived = archivedTargetError(parsed.data.employeeId);
    if (archived) return c.json({ error: archived }, 400);
    const patch = parsed.data;
    const category = patch.category ?? existing.category;

    // Switching an entry's category has to drop the fields the new category can't
    // carry, or the edit gets rejected against the row's leftovers: turning a shift
    // into «Командировка» kept its 09:00–18:00 and tripped "absences must not have
    // times". The caller only sends what changed, so normalise here.
    if (isAbsence(category)) {
      patch.start = null;
      patch.end = null;
      // Тот же довод — про то, чем запись НАЗЫВАЕТСЯ. Подпись и пресет описывают
      // прежнюю категорию, и оба читателя ставят их выше самой категории: клетка
      // подписана `title ?? categoryLabel(category)` и покрашена по пресету, а
      // `encodeEntryCode` пишет в CSV код пресета раньше кода отсутствия. Поэтому
      // «Утро» → «Отпуск» доезжало до базы и не меняло на экране ничего: та же
      // подпись, тот же цвет, — а выгрузка потом писала туда смену, и круг через
      // Excel стирал отпуск обратно в смену.
      // Безусловно, а не «если категория поменялась»: иначе уже испорченную
      // запись нельзя вылечить, пересохранив её отпуском. Отнимать тут нечего —
      // подпись отсутствию не ставит никто: ни форма записи в обеих мордах, ни
      // импорт ростера (там у отсутствий `title: null, templateId: null`).
      patch.templateId = null;
      patch.title = null;
    } else if (countsForBalance(category)) {
      patch.endDate = null;
    }

    // Работа сменилась на другую работу: пресет и подпись прежней уходят, если
    // правка не назвала запись сама («стало дежурством на Вавилова» — называет).
    if (patch.category !== undefined && patch.category !== existing.category) {
      if (patch.templateId === undefined) patch.templateId = null;
      if (patch.title === undefined) patch.title = null;
    }

    // Та же семья, ветка «Своё время»: обе формы шлют часы и `title: null`, но
    // пресет снять забывают, а он — цвет клетки и код в выгрузке. Смена, которой
    // руками поставили 10:00–19:00, оставалась цвета «Утро» и выгружалась кодом
    // «Утро», то есть круг через Excel возвращал ей 08:00–17:00. Правка, которая
    // называет часы и не называет пресет, пресетом больше не описывается: режим
    // пресета в обеих формах всегда шлёт `templateId` вместе с часами.
    if (patch.start !== undefined && patch.templateId === undefined) patch.templateId = null;

    const merged = {
      category,
      date: patch.date ?? existing.date,
      endDate: patch.endDate !== undefined ? patch.endDate : existing.endDate,
      start: patch.start !== undefined ? patch.start : existing.start,
      end: patch.end !== undefined ? patch.end : existing.end,
    };
    const err = entryTimesError(merged) ?? entryDateError(merged) ?? entryRangeError(merged);
    if (err) return c.json({ error: "invalid", issues: [{ message: err }] }, 400);

    // `unrecognisedCode` means «импорт не смог прочитать эту клетку», and every
    // reader puts it above everything else: `encodeEntryCode` writes the raw text
    // back out first, the report files the entry under «не распознано», and both
    // grids draw it that way. The column is not in `updateEntrySchema`, so nothing
    // could ever take it off — an admin turning such a cell into a normal shift got
    // a 200, the row got its preset and its hours, and the cell went on saying «Ко»
    // for good. An edit that says what the entry IS has read it, so the mark goes.
    // Moving the cell to another day has not read it, so that one keeps it.
    // Cleared alongside the patch rather than through the schema on purpose: the
    // column stays un-settable from outside, which is what keeps the import the only
    // thing that can mark a cell unread (pinned by its own API test).
    const namesTheEntry = ["templateId", "title", "start", "end", "category"] as const;
    const clearsUnread = existing.unrecognisedCode != null && namesTheEntry.some((field) => patch[field] !== undefined);
    const entry = updateShift(db, id, clearsUnread ? { ...patch, unrecognisedCode: null } : patch);
    if (!entry) return c.json({ error: "not_found" }, 404);
    recordAudit(db, "entry_updated", c.get("auth").employeeId, { before: auditShape(existing), after: auditShape(entry) });
    const notified = await notifyEntryChange(db, bot, {
      actorEmployeeId: c.get("auth").employeeId, before: existing, after: entry, now: teamNow(config.teamTz),
    });
    return c.json({ entry, notified });
  });

  /**
   * Много записей одним запросом — иначе «Заполнить неделю» это семь
   * `POST /api/admin/entries` подряд, семь строк в журнале и семь отдельных писем
   * человеку за одно нажатие. Атомарно: ссылка на архивного отклоняет ВСЮ пачку
   * ДО записи, а сама запись идёт одной транзакцией — либо все семь, либо ни одной.
   */
  app.post("/api/admin/entries/bulk", requireAdmin(db, config.jwtSecret), async (c) => {
    const parsed = z.object({ entries: z.array(createEntrySchema).min(1).max(200) })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    for (const input of parsed.data.entries) {
      const archived = archivedTargetError(input.employeeId);
      if (archived) return c.json({ error: archived }, 400);
    }
    const dates = parsed.data.entries.map((e) => e.date).sort();
    const { result: entries, diffs } = withScheduleDiff(db, { from: dates[0]!, to: dates.at(-1)! }, () =>
      db.transaction(() => parsed.data.entries.map((input) => createShift(db, input))),
    );
    for (const entry of entries) recordAudit(db, "entry_created", c.get("auth").employeeId, auditShape(entry));
    const notified = await notifyScheduleChange(db, bot, {
      actorEmployeeId: c.get("auth").employeeId, diffs, cause: "fill_week", now: teamNow(config.teamTz),
    });
    return c.json({ created: entries.length, entries, notified }, 201);
  });

  app.delete("/api/admin/entries/:id", requireAdmin(db, config.jwtSecret), async (c) => {
    const id = Number(c.req.param("id"));
    // Read it before it's gone — the feed has to be able to say what was deleted.
    const existing = getShift(db, id);
    // Same reason, for the swaps hanging on it: `deleteShift` expires them and nulls
    // their pointer at this entry, so a line naming the shift can only be built now.
    const linesBefore = new Map(listPendingSwapsForShift(db, id).map((r) => [r.id, swapAuditPayload(r)]));
    const { deleted, expiredSwaps } = deleteShift(db, id);
    if (!deleted) return c.json({ error: "not_found" }, 404);
    if (existing) recordAudit(db, "entry_deleted", c.get("auth").employeeId, auditShape(existing));
    for (const request of expiredSwaps) {
      const payload = linesBefore.get(request.id) ?? swapAuditPayload(request);
      // The admin who deleted the entry is the actor — nobody involved in the swap
      // did anything, which is exactly why they both have to be told.
      recordAudit(db, "swap_expired", c.get("auth").employeeId, payload);
      if (!bot) continue;
      for (const employeeId of [request.fromEmployeeId, request.toEmployeeId]) {
        const tg = tgOf(employeeId);
        if (tg != null) await notifyUser(bot, tg, swapExpiredText(payload, "entry_deleted"));
      }
    }
    const notified = existing
      ? await notifyEntryChange(db, bot, {
          actorEmployeeId: c.get("auth").employeeId, before: existing, after: null, now: teamNow(config.teamTz),
        })
      : { delivered: 0, intended: 0 };
    return c.json({ ok: true, notified });
  });

  const tgOf = (employeeId: number): number | null => getEmployeeById(db, employeeId)?.telegramUserId ?? null;

  type ShiftSummary = { date: string; start: string | null; end: string | null; title: string | null };
  const shiftSummaryOf = (shiftId: number | null): ShiftSummary | null => {
    const shift: Shift | undefined = shiftId == null ? undefined : getShift(db, shiftId);
    if (!shift) return null;
    return { date: shift.date, start: shift.start, end: shift.end, title: shift.title };
  };
  // Formatting + payload helpers below are thin `db`-bound wrappers around
  // ../util/message-lines — shared verbatim with the bot's own callback
  // handlers (bot.ts) so a swap or weekend action resolved on either surface
  // produces byte-identical journal rows and chat text. Keep the short local
  // names so the many call sites below don't change.
  const nameOf = (employeeId: number): string | null => nameOfDb(db, employeeId);
  const shiftLineOf = (shiftId: number | null): string => shiftLineOfDb(db, shiftId);
  const swapAuditPayload = (request: { id: number; fromEmployeeId: number; toEmployeeId: number; fromShiftId: number | null; toShiftId: number | null }) =>
    swapAuditPayloadDb(db, request);

  /** Journals a swap that expired on its own and tells the side that wasn't
   *  looking — the initiator, who proposed it and did nothing since. */
  const announceExpiredSwap = async (request: SwapRequest, actorEmployeeId: number): Promise<void> => {
    const payload = swapAuditPayload(request);
    recordAudit(db, "swap_expired", actorEmployeeId, payload);
    if (!bot) return;
    const tg = tgOf(request.fromEmployeeId);
    if (tg != null) await notifyUser(bot, tg, swapExpiredText(payload, "shift_changed"));
  };

  app.post("/api/swaps", requireAuth(db, config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { fromShiftId?: number; toShiftId?: number; message?: string };
    if (typeof body.fromShiftId !== "number" || typeof body.toShiftId !== "number") return c.json({ error: "fromShiftId and toShiftId required" }, 400);
    if (body.message !== undefined && (typeof body.message !== "string" || body.message.length > 500)) return c.json({ error: "invalid_message" }, 400);
    const res = createSwap(
      db,
      { fromEmployeeId: c.get("auth").employeeId, fromShiftId: body.fromShiftId, toShiftId: body.toShiftId, message: body.message },
      teamNow(config.teamTz),
    );
    if (!res.ok) return c.json({ error: res.reason }, 400);
    // The initiator proposed it — record before notifying, since the notification is
    // best-effort and shouldn't gate the journal entry either way.
    recordAudit(db, "swap_proposed", c.get("auth").employeeId, swapAuditPayload(res.request));
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

  app.post("/api/swaps/:id/accept", requireAuth(db, config.jwtSecret), async (c) => {
    const res = acceptSwap(db, Number(c.req.param("id")), c.get("auth").employeeId, teamNow(config.teamTz));
    if (!res.ok) {
      // A failure that also retired the request for good: the tapper reads why in
      // this response, the initiator hears nothing unless we say so here.
      if (res.expired) await announceExpiredSwap(res.expired, c.get("auth").employeeId);
      return c.json({ error: res.reason }, 400);
    }
    // The caller is the counterparty — acceptSwap only succeeds when req.toEmployeeId
    // === the acting employee — so they are the actor of "accepted", not the initiator.
    recordAudit(db, "swap_accepted", c.get("auth").employeeId, swapAuditPayload(res.request));
    // Its own event, not `swap_cancelled`: nobody withdrew these, an accept knocked
    // them out. Filed under the accepter, who caused it. Journalled whether or not
    // there is a bot to notify anyone with.
    const siblingPayloads = new Map((res.cancelledSiblings ?? []).map((s) => [s.id, swapAuditPayload(s)]));
    for (const [, payload] of siblingPayloads) {
      recordAudit(db, "swap_auto_cancelled", c.get("auth").employeeId, payload);
    }
    if (bot) {
      const tg = tgOf(res.counterpartyId); if (tg != null) await notifyUser(bot, tg, swapAcceptedText(swapAuditPayload(res.request)));
      await notifyAdmins(bot, db, swapAcceptedAdminText(swapAuditPayload(res.request)));
      // Accepting can silently auto-cancel other pending swaps that touched the
      // same shift(s). Both of their sides are told: the counterparty otherwise
      // only learns by tapping a now-stale button and getting a bare "not_pending",
      // and the initiator — who has been waiting and did nothing — otherwise sees
      // «Отменено» indistinguishable from having withdrawn it themselves.
      for (const sibling of res.cancelledSiblings ?? []) {
        const text = swapAutoCancelledText(siblingPayloads.get(sibling.id)!);
        for (const employeeId of [sibling.fromEmployeeId, sibling.toEmployeeId]) {
          const siblingTg = tgOf(employeeId);
          if (siblingTg != null) await notifyUser(bot, siblingTg, text);
        }
      }
    }
    return c.json({ ok: true });
  });

  app.post("/api/swaps/:id/decline", requireAuth(db, config.jwtSecret), async (c) => {
    const res = declineSwap(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!res.ok) return c.json({ error: res.reason }, 400);
    recordAudit(db, "swap_declined", c.get("auth").employeeId, swapAuditPayload(res.request));
    if (bot) { const tg = tgOf(res.counterpartyId); if (tg != null) await notifyUser(bot, tg, swapDeclinedText(swapAuditPayload(res.request))); }
    return c.json({ ok: true });
  });

  app.post("/api/swaps/:id/cancel", requireAuth(db, config.jwtSecret), async (c) => {
    const res = cancelSwap(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!res.ok) return c.json({ error: res.reason }, 400);
    recordAudit(db, "swap_cancelled", c.get("auth").employeeId, swapAuditPayload(res.request));
    if (bot) { const tg = tgOf(res.counterpartyId); if (tg != null) await notifyUser(bot, tg, "Заявку на обмен отменили."); }
    return c.json({ ok: true });
  });

  /** Shared guard for the ranged admin reports: a real calendar range, in order, and
   *  bounded. Unbounded spans scan the whole table inside the same process that
   *  long-polls the bot, so a typo could stall every worker's chat. */
  const rangeError = (from: unknown, to: unknown, maxSpanDays: number): string | null => {
    if (typeof from !== "string" || typeof to !== "string" || !from || !to) return "from and to are required";
    if (!dateStr.safeParse(from).success || !dateStr.safeParse(to).success) {
      return "from and to must be valid YYYY-MM-DD dates";
    }
    if (from > to) return "from must not be after to";
    if (dayNumber(to) - dayNumber(from) > maxSpanDays) {
      return `the range must span at most ${maxSpanDays + 1} days`;
    }
    return null;
  };

  // Who may take each kind of shift, and who asked for it. One object per preset;
  // an empty pool is an unconfigured preset and means everyone.
  app.get("/api/admin/templates/roles", requireAdmin(db, config.jwtSecret), (c) => {
    const roles = getAllTemplateRoles(db);
    return c.json({
      templates: listActiveTemplates(db).map((template) => ({
        templateId: template.id,
        name: template.name,
        category: template.category,
        accent: template.accent,
        ...(roles.get(template.id) ?? { pool: [], preference: {} }),
      })),
    });
  });

  // Whose turn it is for a kind of shift. The bot only suggests — it never assigns
  // a duty itself, so this is a read-only hint the admin acts on or ignores.
  app.get("/api/admin/templates/:id/queue", requireAdmin(db, config.jwtSecret), (c) => {
    const templateId = Number(c.req.param("id"));
    const template = listActiveTemplates(db).find((item) => item.id === templateId);
    if (!template) return c.json({ error: "not_found" }, 404);

    const asOf = c.req.query("asOf") ?? teamNow(config.teamTz).date;
    if (!dateStr.safeParse(asOf).success) return c.json({ error: "asOf must be a valid YYYY-MM-DD date" }, 400);

    const queue = rotationQueue(rotationCandidatesFor(db, templateId, asOf), asOf);
    return c.json({
      templateId,
      rotationUnit: template.rotationUnit,
      asOf,
      queue: queue.map((turn) => ({ ...turn, label: describeTurn(turn, template.rotationUnit) })),
    });
  });

  app.put("/api/admin/templates/:id/rotation", requireAdmin(db, config.jwtSecret), async (c) => {
    const templateId = Number(c.req.param("id"));
    if (!listActiveTemplates(db).some((item) => item.id === templateId)) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { rotationUnit?: unknown };
    if (body.rotationUnit !== "day" && body.rotationUnit !== "week") {
      return c.json({ error: "rotationUnit must be «day» or «week»" }, 400);
    }
    setRotationUnit(db, templateId, body.rotationUnit);
    recordAudit(db, "template_rotation_changed", c.get("auth").employeeId, { templateId, rotationUnit: body.rotationUnit });
    return c.json({ templateId, rotationUnit: body.rotationUnit });
  });

  app.put("/api/admin/templates/:id/roles", requireAdmin(db, config.jwtSecret), async (c) => {
    const templateId = Number(c.req.param("id"));
    if (!listActiveTemplates(db).some((template) => template.id === templateId)) {
      return c.json({ error: "not_found" }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as { pool?: unknown; preference?: unknown };
    if (!Array.isArray(body.pool) || body.pool.some((id) => !Number.isInteger(id))) {
      return c.json({ error: "pool must be an array of employee ids" }, 400);
    }
    const preference: Record<number, number> = {};
    if (body.preference !== undefined) {
      if (typeof body.preference !== "object" || body.preference === null || Array.isArray(body.preference)) {
        return c.json({ error: "preference must be an object of employeeId -> weight" }, 400);
      }
      for (const [key, weight] of Object.entries(body.preference)) {
        const employeeId = Number(key);
        if (!Number.isInteger(employeeId) || typeof weight !== "number" || !Number.isFinite(weight)) {
          return c.json({ error: "preference must be an object of employeeId -> weight" }, 400);
        }
        preference[employeeId] = Math.trunc(weight);
      }
    }

    try {
      const saved = setTemplateRoles(db, templateId, { pool: body.pool as number[], preference });
      recordAudit(db, "template_roles_changed", c.get("auth").employeeId, {
        templateId,
        poolSize: saved.pool.length,
        preferred: Object.keys(saved.preference).length,
      });
      return c.json({ templateId, ...saved });
    } catch (err) {
      if (err instanceof UnknownEmployeesError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  app.post("/api/admin/distribute", requireAdmin(db, config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { from?: unknown; to?: unknown; apply?: unknown };
    // A quarter is already far beyond how far ahead this team plans.
    const err = rangeError(body.from, body.to, 92);
    if (err) return c.json({ error: err }, 400);
    const { assignments, unfilled } = buildDistribution(db, body.from as string, body.to as string);
    let notified: { delivered: number; intended: number } = { delivered: 0, intended: 0 };
    if (body.apply === true) {
      const { diffs } = withScheduleDiff(db, { from: body.from as string, to: body.to as string }, () =>
        applyDistribution(db, assignments.map((a) => ({ shiftId: a.shiftId, employeeId: a.employeeId }))),
      );
      // One press moves a whole week of shifts, so it belongs in «кто когда что
      // менял» like every other schedule change. A preview writes nothing and is
      // recorded as nothing — the log is for what happened, not what was looked at.
      recordAudit(db, "distribution_applied", c.get("auth").employeeId, {
        from: body.from as string,
        to: body.to as string,
        count: assignments.length,
      });
      notified = await notifyScheduleChange(db, bot, {
        actorEmployeeId: c.get("auth").employeeId, diffs, cause: "distribute", now: teamNow(config.teamTz),
      });
    }
    // `unfilled` rides along on a preview too: an empty cell nobody can take is worth
    // knowing about before applying anything, not after.
    return c.json({ applied: body.apply === true, assignments, unfilled, notified });
  });

  app.get("/api/swaps", requireAuth(db, config.jwtSecret), (c) => {
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
  app.get("/api/weekend/slots", requireAuth(db, config.jwtSecret), (c) => {
    const from = c.req.query("from") ?? teamNow(config.teamTz).date;
    return c.json({ slots: openSlotsForWorker(db, c.get("auth").employeeId, from) });
  });

  // Worker: express interest in a slot (idempotent)
  app.post("/api/weekend/slots/:id/interest", requireAuth(db, config.jwtSecret), (c) => {
    const res = expressInterest(db, Number(c.req.param("id")), c.get("auth").employeeId, teamNow(config.teamTz).date);
    if (!res.ok) return c.json({ error: res.reason }, 400);
    return c.json({ ok: true }, 201);
  });

  // Worker: my offered/confirmed weekend assignments
  app.get("/api/weekend/offers", requireAuth(db, config.jwtSecret), (c) =>
    c.json({ offers: myOffers(db, c.get("auth").employeeId) }),
  );

  // Worker: confirm an offer -> creates a weekend_work shift
  app.post("/api/weekend/offers/:id/confirm", requireAuth(db, config.jwtSecret), async (c) => {
    const res = confirmOffer(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!res.ok) return c.json({ error: res.reason }, 400);
    if (bot) {
      const slot = getVacantSlot(db, res.slotId);
      const name = nameOf(c.get("auth").employeeId) ?? "Работник";
      await notifyAdmins(bot, db, weekendConfirmedAdminText(name, slot ? slotLineOf(slot) : "выходную смену"));
    }
    return c.json({ ok: true });
  });

  // Worker: decline an offer -> slot reopens
  app.post("/api/weekend/offers/:id/decline", requireAuth(db, config.jwtSecret), async (c) => {
    const res = declineOffer(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!res.ok) return c.json({ error: res.reason }, 400);
    if (bot) {
      const slot = getVacantSlot(db, res.slotId);
      const name = nameOf(c.get("auth").employeeId) ?? "Работник";
      await notifyAdmins(bot, db, weekendDeclinedAdminText(name, slot ? slotLineOf(slot) : "выходную смену"));
    }
    return c.json({ ok: true });
  });

  // Admin: post a new vacant slot
  app.post("/api/admin/weekend/slots", requireAdmin(db, config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      date?: unknown; start?: unknown; end?: unknown; title?: unknown; location?: unknown; note?: unknown;
    };
    if (typeof body.date !== "string" || typeof body.start !== "string" || typeof body.end !== "string") {
      return c.json({ error: "date, start and end are required" }, 400);
    }
    // The slot's own times are copied verbatim into a `weekend_work` entry when
    // somebody is assigned — the one write into `shifts` that never passes through
    // `createEntrySchema`. «Строка» was the whole guard, so «абв» went into the
    // database, went out to the whole team as «нужен человек на выходной», and
    // surfaced two steps later as a bare 500 on «Назначить»: `hours` is derived from
    // these times, and NaN violates NOT NULL. Same schemas the entry API uses.
    if (!dateStr.safeParse(body.date).success) {
      return c.json({ error: "Дата должна быть в виде ГГГГ-ММ-ДД" }, 400);
    }
    for (const [label, value] of [["Начало", body.start], ["Конец", body.end]] as const) {
      if (!timeStr.safeParse(value).success) {
        return c.json({ error: `${label} смены должно быть временем в виде ЧЧ:ММ` }, 400);
      }
    }
    // Assigning a slot writes a weekend_work entry, so a weekday slot could never
    // produce a coherent one — reject it here rather than at assign time.
    if (!isWeekend(body.date)) {
      return c.json({ error: "Вакантный день может быть только субботой или воскресеньем" }, 400);
    }
    // A slot in the past can't be volunteered for or handed to anybody (see
    // `slotUnusableReason`), so posting one only broadcasts a question nobody can
    // answer. A mistyped year is the way this happens.
    if (body.date < teamNow(config.teamTz).date) {
      return c.json({ error: "Эта дата уже прошла — вакантную смену можно открыть только на будущее" }, 400);
    }
    const title = typeof body.title === "string" ? body.title : null;
    const location = typeof body.location === "string" ? body.location : null;

    // Двойной тап по «Опубликовать» шлёт этот POST дважды с одинаковым телом — без
    // этой проверки вторая копия ушла бы всей команде вторым «Нужен человек на
    // выходной» про ту же самую смену. Точное совпадение: другое время или другое
    // место — это законно новая смена, а не повтор клика.
    const duplicate = findOpenSlotLike(db, { date: body.date, start: body.start, end: body.end, title, location });
    if (duplicate) {
      return c.json({ slot: duplicate, delivered: 0, intended: 0 }, 200);
    }

    const slot = postSlot(db, {
      date: body.date,
      start: body.start,
      end: body.end,
      title,
      location,
      note: typeof body.note === "string" ? body.note : null,
    });
    // How many of the team the call for volunteers actually reached — a slot posted
    // to a team where most people never opened the bot is a question asked of
    // nobody, and the admin has no other way to find that out.
    const reach = bot
      ? await notifyVacantSlot(bot, db, slot.id, `Нужен человек на выходной:\n${slotLineOf(slot)}\n\nНажми «Хочу», если готов выйти.`)
      : { delivered: 0, intended: listActive(db).length };
    recordAudit(db, "weekend_slot_created", c.get("auth").employeeId, {
      slotId: slot.id,
      slot: slotLineOf(slot),
      ...reach,
    });
    return c.json({ slot, ...reach }, 201);
  });

  // Admin: open slots with their ranked interested list (fairness hint: confirmedThisMonth asc)
  app.get("/api/admin/weekend/slots", requireAdmin(db, config.jwtSecret), (c) => {
    const from = c.req.query("from") ?? teamNow(config.teamTz).date;
    const slots = listOpenSlots(db, from).map((slot) => ({
      slot,
      interested: interestedForSlot(db, slot.id),
      assignees: assigneesForSlot(db, slot.id),
    }));
    return c.json({ slots });
  });

  // Admin: assign a slot to an interested worker -> creates an offered assignment
  app.post("/api/admin/weekend/slots/:id/assign", requireAdmin(db, config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { employeeId?: unknown };
    if (typeof body.employeeId !== "number") return c.json({ error: "employeeId is required" }, 400);
    const res = assignSlot(db, Number(c.req.param("id")), body.employeeId, teamNow(config.teamTz).date);
    if (!res.ok) return c.json({ error: res.reason }, 400);
    const slot = getVacantSlot(db, res.assignment.slotId);
    recordAudit(db, "weekend_assigned", c.get("auth").employeeId, {
      slotId: res.assignment.slotId,
      employeeId: body.employeeId,
      employeeName: nameOf(body.employeeId) ?? "Неизвестно",
      slot: slot ? slotLineOf(slot) : null,
    });
    // A repeat assign of someone already on the slot is a no-op (see assignSlot) —
    // nothing changed, so nudging them again would just be a duplicate ping for the
    // same offer they've already seen.
    if (bot && res.changed) {
      const tg = tgOf(body.employeeId);
      if (tg != null && slot) {
        await notifyWeekendOffer(bot, tg, res.assignment.id, `Тебе предложили работу в выходной:\n${slotLineOf(slot)}\n\nПодтвердишь?`);
      }
    }
    return c.json({ assignment: res.assignment }, 201);
  });

  // Admin: take someone off a slot (also removes their schedule entry).
  app.post("/api/admin/weekend/assignments/:id/unassign", requireAdmin(db, config.jwtSecret), async (c) => {
    const res = unassign(db, Number(c.req.param("id")));
    if (!res.ok) return c.json({ error: res.reason }, 400);
    // The reverse direction (worker declines) already notifies the admin —
    // close the loop here so the worker doesn't just find their shift gone.
    if (bot) {
      const tg = tgOf(res.employeeId);
      if (tg != null) {
        const slot = getVacantSlot(db, res.slotId);
        await notifyUser(bot, tg, weekendUnassignedText(slot ? slotLineOf(slot) : "выходную смену"));
      }
    }
    return c.json({ ok: true });
  });

  // Admin: payroll rows for confirmed weekend work in a date range
  app.get("/api/admin/weekend/payroll", requireAdmin(db, config.jwtSecret), (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    const err = rangeError(from, to, 366);
    if (err) return c.json({ error: err }, 400);
    return c.json({ rows: payrollRows(db, from!, to!) });
  });

  // Admin: same payroll as a downloadable CSV (BOM-prefixed for Excel/Cyrillic)
  app.get("/api/admin/weekend/payroll.csv", requireAdmin(db, config.jwtSecret), (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    const err = rangeError(from, to, 366);
    if (err) return c.json({ error: err }, 400);
    const csv = payrollCsv(payrollRows(db, from!, to!));
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="weekend-payroll-${from}_${to}.csv"`);
    return c.body("﻿" + csv);
  });

  // Admin: the whole roster as the same дд.мм.гггг × ФИО matrix the import reads.
  app.get("/api/admin/roster.csv", requireAdmin(db, config.jwtSecret), (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) return c.json({ error: "from and to are required" }, 400);
    if (!dateStr.safeParse(from).success || !dateStr.safeParse(to).success) {
      return c.json({ error: "from and to must be valid YYYY-MM-DD dates" }, 400);
    }
    if (from > to) return c.json({ error: "from must not be after to" }, 400);
    if (dayNumber(to) - dayNumber(from) > 366) {
      return c.json({ error: "the range must span at most 366 days" }, 400);
    }
    const csv = buildRosterCsv(db, from, to);
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="roster-${from}_${to}.csv"`);
    return c.body("﻿" + csv);
  });

  const MAX_CSV_BYTES = 1_000_000;
  /** JSON overhead around a 1 MB string (escaping, the wrapper object) — generous, but
   *  a hard stop long before an upload can buffer the whole process out of memory. */
  const MAX_UPLOAD_BYTES = 4_000_000;

  /** Refuses an oversized upload from the header alone, BEFORE c.req.json() buffers it.
   *  This process also long-polls the bot, so one giant body would stall the whole team. */
  const oversizedUpload = (c: { req: { header(name: string): string | undefined } }): boolean => {
    const declared = Number(c.req.header("content-length"));
    return Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES;
  };

  /** «Игорь Петров, 01.08.2026 — «wat»» — an unread cell as the admin sees it in Excel.
   *  A warning, not an error: the import goes through and marks those cells «?». */
  const describeUnknowns = (unknowns: { name: string; date: string; code: string }[]): string => {
    const shown = unknowns.slice(0, 5).map((u) => {
      const [y, m, d] = u.date.split("-");
      return `${u.name}, ${d}.${m}.${y} — «${u.code}»`;
    });
    const rest = unknowns.length - shown.length;
    const plural = unknowns.length === 1 ? "клетку" : "клеток";
    return `Не понял ${unknowns.length} ${plural}: ${shown.join("; ")}${rest > 0 ? ` и ещё ${rest}` : ""}. ` +
      `Загружу их со знаком «?» — поправьте в файле и загрузите снова, когда будет удобно.`;
  };

  const decodeUploadedRoster = (csv: unknown) => {
    if (typeof csv !== "string" || csv.trim().length === 0) {
      return { ok: false as const, status: 400 as const, body: { error: "csv is required" } };
    }
    if (new TextEncoder().encode(csv).byteLength > MAX_CSV_BYTES) {
      return { ok: false as const, status: 413 as const, body: { error: "Файл больше 1 МБ — загрузите месяц отдельно" } };
    }
    try {
      const parsed = parseRosterCsv(csv);
      if (parsed.dates.length === 0) throw new Error("в шапке CSV нет дат");
      if (parsed.people.length === 0) throw new Error("в CSV нет сотрудников");
      if (parsed.people.some((person) => !person.name)) throw new Error("в CSV есть строка без ФИО");
      const seenNames = new Set<string>();
      for (const person of parsed.people) {
        if (seenNames.has(person.name)) throw new Error(`в CSV повторяется ФИО «${person.name}»`);
        seenNames.add(person.name);
      }
      const decoded = decodeRoster(parsed, listActiveTemplates(db));
      return { ok: true as const, parsed, decoded };
    } catch (err) {
      return {
        ok: false as const,
        status: 400 as const,
        body: { error: err instanceof Error ? err.message : "не удалось разобрать CSV" },
      };
    }
  };

  // Admin: parse and validate an uploaded roster without mutating the database.
  app.post("/api/admin/roster/import/preview", requireAdmin(db, config.jwtSecret), async (c) => {
    if (oversizedUpload(c)) return c.json({ error: "Файл больше 1 МБ — загрузите месяц отдельно" }, 413);
    const body = (await c.req.json().catch(() => ({}))) as { csv?: unknown };
    const result = decodeUploadedRoster(body.csv);
    if (!result.ok) return c.json(result.body, result.status);
    const from = result.parsed.dates[0]!;
    const to = result.parsed.dates.at(-1)!;
    const activeByName = new Map(listActive(db).map((employee) => [employee.displayName.trim(), employee.id] as const));
    return c.json({
      from,
      to,
      entryCount: result.decoded.perPerson.reduce((sum, person) => sum + person.entries.length, 0),
      people: result.decoded.perPerson.map((person) => ({
        csvName: person.name,
        suggestedEmployeeId: activeByName.get(person.name.trim()) ?? null,
      })),
      // Cells we could not read. No longer fatal: they are listed here so the screen
      // can say exactly where they are, and they import as «?».
      unknowns: result.decoded.unknowns,
      unknownsMessage: result.decoded.unknowns.length > 0 ? describeUnknowns(result.decoded.unknowns) : null,
      // Cells exported as '?' — real entries the CSV can't express, which the import
      // will step around rather than recreate.
      preservedCount: result.decoded.preserved.length,
      // What the period already holds. Non-zero means applying needs `overwrite`.
      existingCount: listShiftsOverlapping(db, from, to).length,
    });
  });

  // Admin: decode the same file again and apply the explicitly confirmed person map in one transaction.
  app.post("/api/admin/roster/import/apply", requireAdmin(db, config.jwtSecret), async (c) => {
    if (oversizedUpload(c)) return c.json({ error: "Файл больше 1 МБ — загрузите месяц отдельно" }, 413);
    const body = (await c.req.json().catch(() => ({}))) as { csv?: unknown; resolutions?: unknown; overwrite?: unknown };
    const result = decodeUploadedRoster(body.csv);
    if (!result.ok) return c.json(result.body, result.status);
    if (!Array.isArray(body.resolutions)) return c.json({ error: "resolutions are required" }, 400);
    if (body.overwrite !== undefined && typeof body.overwrite !== "boolean") {
      return c.json({ error: "overwrite must be a boolean" }, 400);
    }

    const resolutions: PersonResolution[] = [];
    for (const item of body.resolutions) {
      if (typeof item !== "object" || item === null) return c.json({ error: "invalid resolution" }, 400);
      const value = item as Record<string, unknown>;
      if (typeof value.csvName !== "string" || !value.csvName.trim()) {
        return c.json({ error: "invalid csvName in resolution" }, 400);
      }
      if (value.action === "create") {
        resolutions.push({ csvName: value.csvName, action: "create" });
      } else if (value.action === "rename" && Number.isInteger(value.employeeId) && Number(value.employeeId) > 0) {
        resolutions.push({ csvName: value.csvName, action: "rename", employeeId: Number(value.employeeId) });
      } else {
        return c.json({ error: `invalid resolution for ${value.csvName}` }, 400);
      }
    }

    try {
      // The file's own header dates, not the decoded entries' extent: a month that is
      // entirely 'holiday' decodes to nothing yet still means "this month is empty".
      const span = { from: result.parsed.dates[0]!, to: result.parsed.dates.at(-1)! };
      // `expiredSwaps` is the caller's to act on, not the browser's to read — the
      // count it needs is already in the summary.
      const { result: importResult, diffs } = withScheduleDiff(db, span, () =>
        applyRosterImport(db, result.decoded, resolutions, c.get("auth").employeeId, {
          overwrite: body.overwrite === true,
          span,
        }),
      );
      const { expiredSwaps, ...summary } = importResult;
      for (const payload of expiredSwaps) {
        recordAudit(db, "swap_expired", c.get("auth").employeeId, payload);
        if (!bot) continue;
        for (const employeeId of [payload.fromEmployeeId, payload.toEmployeeId]) {
          const tg = tgOf(employeeId);
          if (tg != null) await notifyUser(bot, tg, swapExpiredText(payload, "roster_reimported"));
        }
      }
      const notified = await notifyScheduleChange(db, bot, {
        actorEmployeeId: c.get("auth").employeeId, diffs, cause: "file", now: teamNow(config.teamTz),
      });
      return c.json({
        summary,
        // Repeated on the way out, because the admin may never have looked at the
        // preview — the file can be applied straight from a saved resolution set.
        unknownsMessage: summary.unknowns.length > 0 ? describeUnknowns(summary.unknowns) : null,
        notified,
      }, 201);
    } catch (err) {
      if (err instanceof RosterImportConflictError) {
        return c.json(
          {
            error: `За ${err.from}..${err.to} в базе уже есть ${err.existingCount} записей. ` +
              `Отметьте «перезаписать период», чтобы заменить их.`,
            existingCount: err.existingCount,
            from: err.from,
            to: err.to,
          },
          409,
        );
      }
      return c.json({ error: err instanceof Error ? err.message : "не удалось импортировать CSV" }, 409);
    }
  });

  return app;
}
