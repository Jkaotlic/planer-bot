import { randomBytes } from "node:crypto";
import type { Bot } from "grammy";
import { Hono } from "hono";
import {
  type AdminEmployeeDto,
  type AdminEmployeesResponse,
  type EmployeesResponse,
  PREFERRED_NAME_MAX,
  addressOf,
  isBirthDate,
  normalizePreferredName,
} from "@planer/shared";
import { notifyUser } from "../../bot/notify";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import type { Employee as EmployeeRow } from "../../db/schema";
import { recordAudit } from "../../repo/audit";
import {
  archiveEmployee,
  countActiveAdmins,
  createEmployee,
  findActiveByDisplayName,
  getEmployeeById,
  listActive,
  listForAdmin,
  renameEmployee,
  reorderEmployee,
  restoreEmployee,
  setBirthDate,
  setEmployeeAdmin,
  setEmployeeRestrictions,
  setInviteToken,
  setPreferredName,
} from "../../repo/employees";
import { cancelSwapsForEmployeeTx, pendingSwapsForEmployee } from "../../swap/swap-lock";
import { buildExclusionNotices } from "../../swap/swap-lock-notice";
import { teamNow } from "../../util/team-time";
import { type Env, requireAdmin, requireAuth } from "../middleware";

/** Said at every door that could put two identical ФИО in the active list. Names the
 *  row already holding it, because the fix is to rename one of the two. */
function nameTakenError(taken: string): string {
  return `«${taken}» уже есть в списке. График файлом сверяется по ФИО, поэтому двух одинаковых быть не может — ` +
    `добавьте отчество или инициал, чтобы их было видно врозь.`;
}

/**
 * Работник в том виде, в каком его отдаёт контракт.
 *
 * Одна функция на все ручки домена намеренно: до неё список полей существовал в
 * виде `{ ...employee }` в двух местах, и вместе с нужными десятью полями
 * уезжали ещё девять колонок ряда — включая `inviteToken`, ключ привязки чужого
 * телеграма. Добавить поле в ответ теперь можно только здесь, и `satisfies` на
 * вызывающей стороне сверит его со схемой.
 */
function toAdminEmployee(employee: EmployeeRow): AdminEmployeeDto {
  return {
    id: employee.id,
    displayName: employee.displayName,
    preferredName: employee.preferredName,
    address: addressOf(employee),
    isAdmin: employee.isAdmin,
    isActive: employee.isActive,
    telegramUserId: employee.telegramUserId,
    birthDate: employee.birthDate,
    excludedFromAssignment: employee.excludedFromAssignment,
    excludedFromSwaps: employee.excludedFromSwaps,
  };
}

/** Работники: список для всех, карточка и права — для админа. */
export function createEmployeesRoutes(deps: { db: Db; config: Config; bot?: Bot }): Hono<Env> {
  const { db, config, bot } = deps;
  const routes = new Hono<Env>();

  routes.get("/api/employees", requireAuth(db, config.jwtSecret), (c) =>
    c.json({
      employees: listActive(db).map((e) => ({ id: e.id, displayName: e.displayName })),
    } satisfies EmployeesResponse),
  );

  // `address` is computed, not stored: the admin card shows what the bot will
  // actually say, so it is obvious whose greeting still needs setting.
  //
  // Поля перечислены, а не спреднуты. Раньше здесь стоял `{ ...employee }` с
  // предупреждением «не сужать: экран работников читает оба флага исключений» —
  // флаги на месте, а вместе с ними уезжали ещё девять колонок ряда, включая
  // `inviteToken`: ключ, которым чужой телеграм привязывается к работнику.
  // Ни одну из девяти не объявляет тип `Employee` ни одного из фронтов.
  // Что отдаётся, теперь решает `adminEmployeeSchema`, а не форма таблицы.
  routes.get("/api/admin/employees", requireAdmin(db, config.jwtSecret), (c) =>
    c.json({ employees: listForAdmin(db).map(toAdminEmployee) } satisfies AdminEmployeesResponse),
  );

  routes.post("/api/admin/employees", requireAdmin(db, config.jwtSecret), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { displayName?: unknown };
    if (typeof body.displayName !== "string" || body.displayName.trim().length === 0) {
      return c.json({ error: "displayName is required" }, 400);
    }
    const clash = findActiveByDisplayName(db, body.displayName);
    if (clash) return c.json({ error: nameTakenError(clash.displayName) }, 409);
    const inviteToken = randomBytes(16).toString("hex");
    const employee = createEmployee(db, { displayName: body.displayName, inviteToken });
    recordAudit(db, "employee_created", c.get("auth").employeeId, {
      employeeId: employee.id, displayName: employee.displayName,
    });
    const inviteLink = config.botUsername ? `https://t.me/${config.botUsername}?start=${inviteToken}` : null;
    // Токен приглашения отдаётся здесь намеренно и отдельным полем — админ только
    // что завёл человека и должен получить ссылку. А вот внутри `employee` он
    // ехал вторым, незамеченным путём, вместе с восемью прочими колонками ряда.
    return c.json({ employee: toAdminEmployee(employee), inviteToken, inviteLink }, 201);
  });

  // Rename a worker, set their birthday, and/or flip their two restriction flags.
  // Any field on its own is a valid edit; sending none of them is not, so an
  // empty body can't silently no-op.
  //
  // `employee_updated` (name/birthday/«обращение») and `employee_restrictions_changed`
  // (the two flags) are two different journal rows on purpose: one PATCH touching
  // both kinds writes both — that is the truth about what the admin did. Order
  // matters below and is not stylistic: every DB write (the fields, the flags, the
  // swap cancellations) happens synchronously first; the `await` messaging for the
  // swaps flag runs afterwards, from what those writes returned. The `races` lens
  // already caught a double broadcast in this codebase from a status guard written
  // *after* a loop of awaits — see `setSwapLock`.
  routes.patch("/api/admin/employees/:id", requireAdmin(db, config.jwtSecret), async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as {
      displayName?: unknown; birthDate?: unknown; preferredName?: unknown;
      excludedFromAssignment?: unknown; excludedFromSwaps?: unknown;
    };
    const hasName = body.displayName !== undefined;
    const hasBirthday = body.birthDate !== undefined;
    const hasPreferred = body.preferredName !== undefined;
    const hasExcludedAssignment = body.excludedFromAssignment !== undefined;
    const hasExcludedSwaps = body.excludedFromSwaps !== undefined;
    if (!hasName && !hasBirthday && !hasPreferred && !hasExcludedAssignment && !hasExcludedSwaps) {
      return c.json({ error: "displayName is required" }, 400);
    }

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
    if (hasExcludedAssignment && typeof body.excludedFromAssignment !== "boolean") {
      return c.json({ error: "excludedFromAssignment должен быть true или false" }, 400);
    }
    if (hasExcludedSwaps && typeof body.excludedFromSwaps !== "boolean") {
      return c.json({ error: "excludedFromSwaps должен быть true или false" }, 400);
    }

    let employee = getEmployeeById(db, id);
    if (!employee) return c.json({ error: "not_found" }, 404);
    // Snapshot before the edit: without it a rename leaves no trace — the journal
    // would carry only the new name, with the old one gone from everywhere. A
    // separate snapshot for the two flags — they get their own journal row.
    const beforeEdit = { displayName: employee.displayName, birthDate: employee.birthDate, preferredName: employee.preferredName };
    const beforeRestrictions = { excludedFromAssignment: employee.excludedFromAssignment, excludedFromSwaps: employee.excludedFromSwaps };
    if (hasName) {
      const clash = findActiveByDisplayName(db, body.displayName as string, id);
      if (clash) return c.json({ error: nameTakenError(clash.displayName) }, 409);
    }
    if (hasName) employee = renameEmployee(db, id, (body.displayName as string).trim()) ?? employee;
    if (hasBirthday) employee = setBirthDate(db, id, body.birthDate as string | null) ?? employee;
    if (preferred?.ok) employee = setPreferredName(db, id, preferred.value) ?? employee;

    if (hasName || hasBirthday || hasPreferred) {
      recordAudit(db, "employee_updated", c.get("auth").employeeId, {
        employeeId: id,
        before: beforeEdit,
        after: { displayName: employee.displayName, birthDate: employee.birthDate, preferredName: employee.preferredName },
      });
    }

    if (hasExcludedAssignment || hasExcludedSwaps) {
      const restrictionsPatch: { excludedFromAssignment?: boolean; excludedFromSwaps?: boolean } = {};
      if (hasExcludedAssignment) restrictionsPatch.excludedFromAssignment = body.excludedFromAssignment as boolean;
      if (hasExcludedSwaps) restrictionsPatch.excludedFromSwaps = body.excludedFromSwaps as boolean;

      // Whether this PATCH newly excludes the person from swaps is already
      // knowable from the request body and the snapshot above. Read the
      // payloads for it now, BEFORE the write — same reasoning as
      // `setSwapLock`: `swapAuditPayload` resolves names and shift lines, and
      // those have to describe the trade as it stood.
      const willExcludeFromSwaps = hasExcludedSwaps && body.excludedFromSwaps === true && !beforeRestrictions.excludedFromSwaps;
      const { pending, payloads: cancelledPayloads } = willExcludeFromSwaps
        ? pendingSwapsForEmployee(db, id)
        : { pending: [], payloads: [] };

      // The flag and the cancellations are one fact — half of it landing is
      // worse than neither (an admin would see the flag set while the
      // buttons still worked). Same shape as `setSwapLock`.
      db.transaction((tx) => {
        employee = setEmployeeRestrictions(tx, id, restrictionsPatch) ?? employee;
        if (willExcludeFromSwaps) cancelSwapsForEmployeeTx(tx, pending);
      });

      const afterRestrictions = { excludedFromAssignment: employee.excludedFromAssignment, excludedFromSwaps: employee.excludedFromSwaps };
      const swapsChanged = beforeRestrictions.excludedFromSwaps !== afterRestrictions.excludedFromSwaps;
      const restrictionsChanged = swapsChanged || beforeRestrictions.excludedFromAssignment !== afterRestrictions.excludedFromAssignment;

      // Written only when a flag actually changed value — a rename-only PATCH,
      // or one resending the flags' current values, must not add a row here.
      if (restrictionsChanged) {
        recordAudit(db, "employee_restrictions_changed", c.get("auth").employeeId, {
          employeeId: id,
          displayName: employee.displayName,
          before: beforeRestrictions,
          after: afterRestrictions,
        });
      }

      // The assignment flag is deliberately silent — see `buildExclusionNotices`.
      // Only a real change to `excludedFromSwaps` notifies.
      if (swapsChanged) {
        const others = listActive(db).filter((e) => e.id !== id);
        const notices = buildExclusionNotices({
          excluded: afterRestrictions.excludedFromSwaps,
          person: { id, telegramUserId: employee.telegramUserId },
          others,
          cancelled: cancelledPayloads,
        });
        if (bot) {
          for (const notice of notices) {
            await notifyUser(bot, notice.telegramUserId, notice.text);
          }
        }
      }
    }

    return c.json({ employee: toAdminEmployee(employee) });
  });

  // Move a worker to a position in the list. The number is what the admin sees
  // (1 = first), and the server renumbers everyone so the column stays contiguous.
  routes.post("/api/admin/employees/:id/order", requireAdmin(db, config.jwtSecret), async (c) => {
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
    return c.json({ employees: employees.map(toAdminEmployee) } satisfies AdminEmployeesResponse);
  });

  // Guarded exactly like the /role demote below: archiving an admin reaches the same
  // "no active admin left" dead end, and — unlike a demote — there is no undo button
  // for it anywhere in the app.
  routes.post("/api/admin/employees/:id/archive", requireAdmin(db, config.jwtSecret), (c) => {
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

  routes.post("/api/admin/employees/:id/restore", requireAdmin(db, config.jwtSecret), (c) => {
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
  routes.post("/api/admin/employees/:id/role", requireAdmin(db, config.jwtSecret), async (c) => {
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
    // `undefined` сохраняется как было: ряд под этим id только что читался выше,
    // поэтому ветка недостижима, но сузить её в `null` значило бы поменять тело
    // ответа заодно с формой — а тут переносится форма.
    return c.json({ employee: employee && toAdminEmployee(employee) });
  });

  // (Re)issue an invite link for a worker who hasn't linked their Telegram yet —
  // lets an admin re-show the link or replace a broken/lost one. `regenerate`
  // forces a fresh token (invalidating any previously shared link).
  routes.post("/api/admin/employees/:id/invite", requireAdmin(db, config.jwtSecret), async (c) => {
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
    // Токен сюда не попадает намеренно: это действующий ключ к учётной записи, а
    // журнал открыт всем админам. Важен факт выдачи и то, что прежняя ссылка умерла.
    recordAudit(db, "employee_invite_issued", c.get("auth").employeeId, {
      employeeId: id, displayName: emp.displayName, regenerated: body.regenerate === true,
    });
    return c.json({ inviteToken, inviteLink });
  });

  return routes;
}
