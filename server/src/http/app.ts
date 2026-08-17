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
import { listActiveTemplates, getTemplate } from "../repo/templates";
import { getAllTemplateRoles, setTemplateRoles, rotationCandidatesFor, setRotationUnit, UnknownEmployeesError } from "../repo/template-roles";
import { createShift, updateShift, deleteShift, getShift, listShiftsOverlapping } from "../repo/shifts";
import type { Shift, SwapRequest } from "../db/schema";
import {
  getByTelegramId,
  getEmployeeById,
  createAdminEmployee,
  listActive,
  restoreEmployee,
  setEmployeeAdmin,
  setRemindersEnabled,
  setPreferredName,
  rememberTelegramProfile,
} from "../repo/employees";
import { swapsLockSetting, isSwapsLocked } from "../repo/settings";
import { listMutedKinds, setNoticeMuted } from "../repo/notice-prefs";
import { setSwapLock } from "../swap/swap-lock";
import { buildSwapLockNotices } from "../swap/swap-lock-notice";
import { createEntrySchema, updateEntrySchema, entryTimesError, entryDateError, entryRangeError } from "./entry-schema";
import { createSwap, acceptSwap, declineSwap, cancelSwap } from "../swap/swap-service";
import { outsidePoolFact, outsidePoolFacts } from "../swap/duty-notice";
import { notifyScheduleChange, withScheduleDiff } from "../schedule/change-notice";
import { createNoticeBuffer } from "../schedule/notice-buffer";
import { listSwapsForEmployee, listPendingSwapsForShift } from "../repo/swaps";
import { listRecentAudit, recordAudit, queryAudit } from "../repo/audit";
import {
  notifyUser,
  notifyAdmins,
  notifySwapProposal,
  swapProposalText,
  dutyNoticeForReceiver,
  dutyNoticeForAdmins,
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
  slotLineOf,
  nameOf as nameOfDb,
  swapAuditPayload as swapAuditPayloadDb,
  entryAuditPayload,
} from "../util/message-lines";
import { teamNow } from "../util/team-time";
import { createEmployeesRoutes } from "./routes/employees";
import { createReadRoutes } from "./routes/read";
import { createMyEntryRoutes } from "./routes/my-entries";
import { createMyHandoverRoutes } from "./routes/my-handovers";
import {
  isWeekend,
  isAbsence,
  countsForBalance,
  dateStr,
  timeStr,
  dayNumber,
  rotationQueue,
  describeTurn,
  addressOf,
  normalizePreferredName,
  PREFERRED_NAME_MAX,
  ADMIN_NOTICE_KINDS,
  ADMIN_NOTICE_LABELS,
  type EntryCategory,
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
import { upcomingBirthdays, ensureBirthdayRound, birthdayRoundDraft } from "../birthdays/birthday-service";
import {
  getCollection,
  listCollections,
  createCustomCollection,
  previewCollection,
  updateCollection,
  setCollectionClosed,
  deleteCollection,
  markCollectionSent,
  recipientsOf,
  collectionsForWorker,
} from "../collections/collection-service";
import { parseCollectionBody, scheduledSendOnError } from "./collection-body";

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

  // Registered first (= outermost) so it runs for every response this process
  // serves, including the static /app and /admin bundles mounted later in
  // index.ts — Hono composes "*" middleware around whatever else is
  // registered on the same app instance, regardless of registration order
  // relative to those routes.
  // One buffer per app instance, not per request: it is the thing holding the
  // timers. A hand edit waits in it for a few seconds so a series of edits
  // reaches the worker as one letter instead of one message per entry.
  const noticeBuffer = createNoticeBuffer({ db, bot });

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
      /** The swap rule travels together with "who am I": the screen must grey
       *  out the «Обменять» button, not show it live and get refused on tap. */
      swapsLocked: isSwapsLocked(db),
      excludedFromSwaps: me.excludedFromSwaps,
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

    // Одно действие человека — одна строка журнала: маршрут принимает оба поля
    // разом, и делить его на два события значило бы врать о том, что он сделал.
    recordAudit(db, "settings_changed", id, {
      employeeId: id,
      displayName: employee.displayName,
      ...(hasReminders ? { remindersEnabled: employee.remindersEnabled } : {}),
      ...(preferred?.ok ? { preferredName: employee.preferredName } : {}),
    });

    return c.json({
      remindersEnabled: employee.remindersEnabled,
      preferredName: employee.preferredName,
      // Returned so the greeting can update without a second round trip.
      address: addressOf(employee),
    });
  });

  /**
   * Что писать этому админу.
   *
   * `requireAdmin`, а не `requireAuth`: этих писем не получает никто, кроме
   * админов, и переключатель, который у работника ничего не меняет, — ложь в
   * интерфейсе, а не безобидная лишняя настройка.
   *
   * Адресат берётся из токена, id в пути нет — чужие уведомления выключить нечем,
   * тем же правилом, что и в `/api/me/settings`.
   */
  app.get("/api/me/notifications", requireAdmin(db, config.jwtSecret), (c) => {
    const muted = new Set(listMutedKinds(db, c.get("auth").employeeId));
    return c.json({
      kinds: ADMIN_NOTICE_KINDS.map((kind) => ({
        kind,
        title: ADMIN_NOTICE_LABELS[kind].title,
        hint: ADMIN_NOTICE_LABELS[kind].hint,
        enabled: !muted.has(kind),
      })),
    });
  });

  app.patch("/api/me/notifications", requireAdmin(db, config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { kind?: unknown; enabled?: unknown };
    if (typeof body.enabled !== "boolean") return c.json({ error: "enabled должен быть true или false" }, 400);
    // Проверяем по списку, а не по типу: тело приходит из сети, и `as AdminNoticeKind`
    // завёл бы строку с любым мусором в `kind`.
    const kind = ADMIN_NOTICE_KINDS.find((k) => k === body.kind);
    if (!kind) return c.json({ error: "неизвестный вид уведомления" }, 400);

    const id = c.get("auth").employeeId;
    setNoticeMuted(db, id, kind, !body.enabled);
    recordAudit(db, "notice_prefs_changed", id, {
      employeeId: id,
      kind,
      title: ADMIN_NOTICE_LABELS[kind].title,
      enabled: body.enabled,
    });
    return c.json({ kind, enabled: body.enabled });
  });

  app.route("/", createReadRoutes({ db, config }));

  app.route("/", createMyEntryRoutes({ db, config, bot }));
  app.route("/", createMyHandoverRoutes({ db, config, bot }));

  app.route("/", createEmployeesRoutes({ db, config, bot }));

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

  app.get("/api/admin/settings", requireAdmin(db, config.jwtSecret), (c) => {
    const setting = swapsLockSetting(db);
    const actor = setting?.updatedByEmployeeId == null ? undefined : getEmployeeById(db, setting.updatedByEmployeeId);
    return c.json({
      swapsLocked: isSwapsLocked(db),
      swapsLockUpdatedAt: setting?.updatedAt?.toISOString() ?? null,
      swapsLockUpdatedBy: actor?.displayName ?? null,
    });
  });

  /**
   * The team-wide swap switch.
   *
   * Order matters and is not stylistic: the database write and the cancellation
   * happen first, synchronously, in one transaction; only then does the awaited
   * broadcast run. The `races` lens already caught a double broadcast in this
   * codebase that came from writing a status guard *after* a loop of awaits.
   */
  app.put("/api/admin/settings/swaps-lock", requireAdmin(db, config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { locked?: unknown };
    if (typeof body.locked !== "boolean") return c.json({ error: "locked должен быть true или false" }, 400);

    const actorId = c.get("auth").employeeId;
    const cancelled = setSwapLock(db, body.locked, actorId);

    const team = listActive(db);
    const notices = buildSwapLockNotices({ locked: body.locked, team, cancelled });
    let delivered = 0;
    if (bot) {
      for (const notice of notices) {
        if (await notifyUser(bot, notice.telegramUserId, notice.text)) delivered += 1;
      }
    }
    const reach = { delivered, intended: notices.length };

    recordAudit(db, "swaps_lock_changed", actorId, { locked: body.locked, cancelled: cancelled.length, ...reach });
    return c.json({ locked: body.locked, cancelled: cancelled.length, ...reach });
  });

  // --- Дни рождения ---------------------------------------------------------
  // The bot never mails the team on its own. It nudges admins a week ahead; every
  // message after that is an admin pressing a button, having seen exactly what
  // will go out and to whom. A round is created when an admin first SAVES it —
  // looking at the card writes nothing.

  const birthdayAsOf = (c: { req: { query(name: string): string | undefined } }) =>
    c.req.query("asOf") ?? teamNow(config.teamTz).date;

  app.get("/api/admin/birthdays", requireAdmin(db, config.jwtSecret), (c) => {
    const asOf = birthdayAsOf(c);
    if (!dateStr.safeParse(asOf).success) return c.json({ error: "asOf must be a valid YYYY-MM-DD date" }, 400);
    return c.json({ asOf, birthdays: upcomingBirthdays(db, asOf, undefined, c.get("auth").employeeId) });
  });

  app.get("/api/admin/birthdays/:id/preview", requireAdmin(db, config.jwtSecret), (c) => {
    const asOf = birthdayAsOf(c);
    if (!dateStr.safeParse(asOf).success) return c.json({ error: "asOf must be a valid YYYY-MM-DD date" }, 400);
    const employeeId = Number(c.req.param("id"));
    // The surprise rule: not «forbidden», but «there is nothing here for you».
    if (employeeId === c.get("auth").employeeId) return c.json({ error: "not_found" }, 404);
    const draft = birthdayRoundDraft(db, employeeId, asOf);
    if (!draft) return c.json({ error: "not_found" }, 404);
    return c.json(previewCollection(db, draft));
  });

  app.put("/api/admin/birthdays/:id", requireAdmin(db, config.jwtSecret), async (c) => {
    const asOf = birthdayAsOf(c);
    if (!dateStr.safeParse(asOf).success) return c.json({ error: "asOf must be a valid YYYY-MM-DD date" }, 400);
    const employeeId = Number(c.req.param("id"));
    if (employeeId === c.get("auth").employeeId) return c.json({ error: "not_found" }, 404);

    const parsed = parseCollectionBody(await c.req.json().catch(() => ({})), { requireTitle: false });
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    // A birthday round has no subject to edit — it is named after the person.
    if (parsed.value.title !== undefined || parsed.value.employeeId !== undefined) {
      return c.json({ error: "У сбора на день рождения повод и виновник заданы датой рождения." }, 400);
    }

    const round = ensureBirthdayRound(db, employeeId, asOf);
    if (!round) return c.json({ error: "not_found" }, 404);
    const scheduleError = scheduledSendOnError(parsed.value.scheduledSendOn, round, asOf);
    if (scheduleError) return c.json({ error: scheduleError }, 400);

    const result = updateCollection(db, round.id, parsed.value);
    if (!result.ok) return c.json({ error: result.error }, 409);
    recordAudit(db, "birthday_campaign_updated", c.get("auth").employeeId, {
      employeeId,
      displayName: getEmployeeById(db, employeeId)?.displayName ?? null,
      ...(parsed.value.collectUrl !== undefined ? { collectUrl: parsed.value.collectUrl } : {}),
      ...(parsed.value.messageText !== undefined ? { messageText: parsed.value.messageText ? "изменён" : null } : {}),
      ...(parsed.value.scheduledSendOn !== undefined ? { scheduledSendOn: parsed.value.scheduledSendOn } : {}),
    });
    return c.json({ collection: result.collection });
  });

  // --- Сборы ----------------------------------------------------------------
  // One set of routes for both kinds: a birthday round and a hand-made
  // collection differ in data, not in how they are previewed, sent or closed.
  // `:id` here is the COLLECTION's id — unlike the birthday routes above, where
  // it is the employee's.

  /** Reads a collection the viewer is allowed to see, or explains why not. */
  const readableCollection = (db: Db, id: number, viewerId: number) => {
    const collection = getCollection(db, id);
    // The surprise rule: «not found», not «forbidden». A 403 would confirm the
    // collection exists, which is the one bit we are hiding.
    if (!collection || collection.employeeId === viewerId) return null;
    return collection;
  };

  // Claimed synchronously by /send below (see the comment on that route) so a
  // double-tap on the same collection can never produce two broadcasts.
  const collectionSending = new Set<number>();

  app.get("/api/admin/collections", requireAdmin(db, config.jwtSecret), (c) => {
    const asOf = birthdayAsOf(c);
    if (!dateStr.safeParse(asOf).success) return c.json({ error: "asOf must be a valid YYYY-MM-DD date" }, 400);
    return c.json({ asOf, collections: listCollections(db, asOf, c.get("auth").employeeId) });
  });

  app.post("/api/admin/collections", requireAdmin(db, config.jwtSecret), async (c) => {
    const parsed = parseCollectionBody(await c.req.json().catch(() => ({})), { requireTitle: true });
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    if (parsed.value.employeeId != null && !getEmployeeById(db, parsed.value.employeeId)) {
      return c.json({ error: "Такого работника нет" }, 400);
    }

    const collection = createCustomCollection(db, {
      title: parsed.value.title!,
      employeeId: parsed.value.employeeId ?? null,
      eventDate: parsed.value.eventDate ?? null,
      deadline: parsed.value.deadline ?? null,
      amountPerPerson: parsed.value.amountPerPerson ?? null,
      totalGoal: parsed.value.totalGoal ?? null,
      collectUrl: parsed.value.collectUrl ?? null,
      messageText: parsed.value.messageText ?? null,
      scheduledSendOn: parsed.value.scheduledSendOn ?? null,
    });
    recordAudit(db, "collection_created", c.get("auth").employeeId, {
      collectionId: collection.id,
      employeeId: collection.employeeId,
      title: collection.title,
      personName: collection.employeeId != null ? (getEmployeeById(db, collection.employeeId)?.displayName ?? null) : null,
    });
    return c.json({ collection });
  });

  app.get("/api/admin/collections/:id/preview", requireAdmin(db, config.jwtSecret), (c) => {
    const collection = readableCollection(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!collection) return c.json({ error: "not_found" }, 404);
    return c.json(previewCollection(db, collection));
  });

  app.put("/api/admin/collections/:id", requireAdmin(db, config.jwtSecret), async (c) => {
    const asOf = birthdayAsOf(c);
    if (!dateStr.safeParse(asOf).success) return c.json({ error: "asOf must be a valid YYYY-MM-DD date" }, 400);
    const collection = readableCollection(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!collection) return c.json({ error: "not_found" }, 404);

    const parsed = parseCollectionBody(await c.req.json().catch(() => ({})), { requireTitle: false });
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    if (Object.keys(parsed.value).length === 0) return c.json({ error: "нечего сохранять" }, 400);
    if (parsed.value.employeeId != null && !getEmployeeById(db, parsed.value.employeeId)) {
      return c.json({ error: "Такого работника нет" }, 400);
    }
    const scheduleError = scheduledSendOnError(parsed.value.scheduledSendOn, collection, asOf);
    if (scheduleError) return c.json({ error: scheduleError }, 400);

    const result = updateCollection(db, collection.id, parsed.value);
    if (!result.ok) return c.json({ error: result.error }, 409);
    recordAudit(db, "collection_updated", c.get("auth").employeeId, {
      collectionId: collection.id,
      employeeId: result.collection.employeeId,
      title: result.collection.title,
      ...(parsed.value.collectUrl !== undefined ? { collectUrl: parsed.value.collectUrl } : {}),
      ...(parsed.value.deadline !== undefined ? { deadline: parsed.value.deadline } : {}),
      ...(parsed.value.scheduledSendOn !== undefined ? { scheduledSendOn: parsed.value.scheduledSendOn } : {}),
      ...(parsed.value.messageText !== undefined ? { messageText: parsed.value.messageText ? "изменён" : null } : {}),
    });
    return c.json({ collection: result.collection });
  });

  app.post("/api/admin/collections/:id/send", requireAdmin(db, config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { confirm?: unknown };
    if (body.confirm !== true) return c.json({ error: "нужно подтверждение: confirm: true" }, 400);
    const collection = readableCollection(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!collection) return c.json({ error: "not_found" }, 404);

    const preview = previewCollection(db, collection);
    if (preview.blocker) return c.json({ error: preview.blocker }, 409);
    if (!bot) return c.json({ error: "Бот не запущен — рассылка недоступна" }, 503);

    // The claim is synchronous: between this line and the first `await` below
    // nothing else can run (single-threaded Node), so a second simultaneous
    // «Разослать» always finds the collection already taken.
    if (collectionSending.has(collection.id)) return c.json({ error: "Рассылка уже идёт." }, 409);
    collectionSending.add(collection.id);
    try {
      let delivered = 0;
      for (const recipient of recipientsOf(db, collection.employeeId)) {
        if (await notifyUser(bot, recipient.telegramUserId!, preview.message)) delivered += 1;
      }
      // Only count a round that reached somebody: zero delivered is not a round,
      // it is Telegram having refused the lot. Counting it would tell the admin
      // «рассылалось 2 раза» about one real message.
      if (delivered > 0) markCollectionSent(db, collection.id, delivered, new Date());
      recordAudit(db, "collection_sent", c.get("auth").employeeId, {
        collectionId: collection.id,
        employeeId: collection.employeeId,
        title: preview.title,
        round: collection.sendCount + (delivered > 0 ? 1 : 0),
        delivered,
        intended: preview.recipients.length,
      });
      return c.json({ delivered, intended: preview.recipients.length, round: collection.sendCount + (delivered > 0 ? 1 : 0) });
    } finally {
      collectionSending.delete(collection.id);
    }
  });

  app.post("/api/admin/collections/:id/close", requireAdmin(db, config.jwtSecret), async (c) => {
    const collection = readableCollection(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!collection) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { closed?: unknown };
    if (typeof body.closed !== "boolean") return c.json({ error: "closed должен быть true или false" }, 400);

    const updated = setCollectionClosed(db, collection.id, body.closed, new Date());
    if (!updated) return c.json({ error: "not_found" }, 404);
    recordAudit(db, "collection_closed", c.get("auth").employeeId, {
      collectionId: collection.id,
      employeeId: collection.employeeId,
      title: previewCollection(db, updated).title,
      closed: body.closed,
    });
    return c.json({ collection: updated });
  });

  app.delete("/api/admin/collections/:id", requireAdmin(db, config.jwtSecret), (c) => {
    const collection = readableCollection(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!collection) return c.json({ error: "not_found" }, 404);
    const title = previewCollection(db, collection).title;
    const result = deleteCollection(db, collection.id);
    if (!result.ok) return c.json({ error: result.error }, 409);
    recordAudit(db, "collection_deleted", c.get("auth").employeeId, {
      collectionId: collection.id,
      employeeId: collection.employeeId,
      title,
    });
    return c.json({ ok: true });
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

    const page = queryAudit(db, { types, from, to, limit, offset, actorEmployeeId, viewerEmployeeId: c.get("auth").employeeId });
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
    recordAudit(db, "entry_created", c.get("auth").employeeId, entryAuditPayload(db, entry));
    const notified = noticeBuffer.register({
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
    recordAudit(db, "entry_updated", c.get("auth").employeeId, { before: entryAuditPayload(db, existing), after: entryAuditPayload(db, entry) });
    const notified = noticeBuffer.register({
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
    for (const entry of entries) recordAudit(db, "entry_created", c.get("auth").employeeId, entryAuditPayload(db, entry));
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
    if (existing) recordAudit(db, "entry_deleted", c.get("auth").employeeId, entryAuditPayload(db, existing));
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
      ? noticeBuffer.register({
          actorEmployeeId: c.get("auth").employeeId, before: existing, after: null, now: teamNow(config.teamTz),
        })
      : { delivered: 0, intended: 0 };
    return c.json({ ok: true, notified });
  });

  const tgOf = (employeeId: number): number | null => getEmployeeById(db, employeeId)?.telegramUserId ?? null;

  // `category` — не украшение: с 2026-08-10 в обмене бывает дежурство, а карточка
  // «Обменов» иначе отличала бы его от смены по часам, то есть никак. `title` у
  // части записей пуст, и тогда назвать вид записи можно только по категории.
  type ShiftSummary = { date: string; start: string | null; end: string | null; title: string | null; category: EntryCategory };
  const shiftSummaryOf = (shiftId: number | null): ShiftSummary | null => {
    const shift: Shift | undefined = shiftId == null ? undefined : getShift(db, shiftId);
    if (!shift) return null;
    return { date: shift.date, start: shift.start, end: shift.end, title: shift.title, category: shift.category };
  };
  // Formatting + payload helpers below are thin `db`-bound wrappers around
  // ../util/message-lines — shared verbatim with the bot's own callback
  // handlers (bot.ts) so a swap or weekend action resolved on either surface
  // produces byte-identical journal rows and chat text. Keep the short local
  // names so the many call sites below don't change.
  const nameOf = (employeeId: number): string | null => nameOfDb(db, employeeId);
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
        // Вторая сторона получает `fromShift`. Если это дежурство, а её нет в его
        // пуле — она должна прочитать об этом ДО нажатия «Принять», а не потом.
        const fact = outsidePoolFact(db, { shiftId: res.request.fromShiftId, receiverId: res.counterpartyId });
        const notices = fact ? [dutyNoticeForReceiver(fact)] : [];
        await notifySwapProposal(bot, tg, res.request.id, swapProposalText(swapAuditPayload(res.request), notices));
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
      await notifyAdmins(
        bot,
        db,
        "swaps",
        swapAcceptedAdminText(
          swapAuditPayload(res.request),
          outsidePoolFacts(db, res.request).map(dutyNoticeForAdmins),
        ),
      );
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
    recordAudit(db, "template_rotation_changed", c.get("auth").employeeId, {
      templateId, templateName: getTemplate(db, templateId)?.name ?? null, rotationUnit: body.rotationUnit,
    });
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
        templateName: getTemplate(db, templateId)?.name ?? null,
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
    const slotId = Number(c.req.param("id"));
    const res = expressInterest(db, slotId, c.get("auth").employeeId, teamNow(config.teamTz).date);
    if (!res.ok) return c.json({ error: res.reason }, 400);
    const slot = getVacantSlot(db, slotId);
    recordAudit(db, "weekend_interest", c.get("auth").employeeId, {
      slotId,
      slot: slot ? slotLineOf(slot) : null,
      employeeId: c.get("auth").employeeId,
      employeeName: nameOf(c.get("auth").employeeId) ?? null,
    });
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
    const slot = getVacantSlot(db, res.slotId);
    const name = nameOf(c.get("auth").employeeId) ?? "Работник";
    recordAudit(db, "weekend_offer_confirmed", c.get("auth").employeeId, {
      slotId: res.slotId, slot: slot ? slotLineOf(slot) : null,
      employeeId: c.get("auth").employeeId, employeeName: name,
    });
    if (bot) {
      await notifyAdmins(bot, db, "weekend", weekendConfirmedAdminText(name, slot ? slotLineOf(slot) : "выходную смену"));
    }
    return c.json({ ok: true });
  });

  // Worker: decline an offer -> slot reopens
  app.post("/api/weekend/offers/:id/decline", requireAuth(db, config.jwtSecret), async (c) => {
    const res = declineOffer(db, Number(c.req.param("id")), c.get("auth").employeeId);
    if (!res.ok) return c.json({ error: res.reason }, 400);
    const slot = getVacantSlot(db, res.slotId);
    const name = nameOf(c.get("auth").employeeId) ?? "Работник";
    recordAudit(db, "weekend_offer_declined", c.get("auth").employeeId, {
      slotId: res.slotId, slot: slot ? slotLineOf(slot) : null,
      employeeId: c.get("auth").employeeId, employeeName: name,
    });
    if (bot) {
      await notifyAdmins(bot, db, "weekend", weekendDeclinedAdminText(name, slot ? slotLineOf(slot) : "выходную смену"));
    }
    return c.json({ ok: true });
  });

  /** Running collections this person has already been told about. Not their own. */
  app.get("/api/collections", requireAuth(db, config.jwtSecret), (c) => {
    const asOf = birthdayAsOf(c);
    if (!dateStr.safeParse(asOf).success) return c.json({ error: "asOf must be a valid YYYY-MM-DD date" }, 400);
    return c.json({ collections: collectionsForWorker(db, asOf, c.get("auth").employeeId) });
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
      // No bot to actually send through, but the count must still agree with what
      // notifyVacantSlot would have reported — same exclusion filter, or an admin
      // running without a bot configured sees a different, dishonest number.
      : { delivered: 0, intended: listActive(db).filter((employee) => !employee.excludedFromAssignment).length };
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
    if (!res.ok) {
      // "excluded" is the one reason here an admin can act on directly — the worker
      // isn't broken, someone deliberately took them out of assignments — so it gets
      // a human phrase. The other reason codes pass through as-is, unchanged.
      const error = res.reason === "excluded" ? "Этот человек выведен из назначений" : res.reason;
      return c.json({ error }, 400);
    }
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
    const removedSlot = getVacantSlot(db, res.slotId);
    recordAudit(db, "weekend_unassigned", c.get("auth").employeeId, {
      slotId: res.slotId,
      slot: removedSlot ? slotLineOf(removedSlot) : null,
      employeeId: res.employeeId,
      employeeName: nameOf(res.employeeId) ?? null,
    });
    // The reverse direction (worker declines) already notifies the admin —
    // close the loop here so the worker doesn't just find their shift gone.
    if (bot) {
      const tg = tgOf(res.employeeId);
      if (tg != null) {
        await notifyUser(bot, tg, weekendUnassignedText(removedSlot ? slotLineOf(removedSlot) : "выходную смену"));
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
