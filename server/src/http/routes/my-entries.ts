import { Hono } from "hono";
import { z } from "zod";
import type { Bot } from "grammy";
import {
  dateStr,
  timeStr,
  eachDayIso,
  selfEntryRefusal,
  selfEntryEditRefusal,
} from "@planer/shared";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { createShift, getShift, updateShift, deleteShift } from "../../repo/shifts";
import { getEmployeeById } from "../../repo/employees";
import { listPendingSwapsForShift } from "../../repo/swaps";
import { recordAudit } from "../../repo/audit";
import { teamNow } from "../../util/team-time";
import { entryAuditPayload, nameOf, swapAuditPayload } from "../../util/message-lines";
import { entryTimesError, entryDateError, entryRangeError } from "../entry-schema";
import { dayAfterLine } from "../../schedule/day-summary";
import { notifyAdmins, notifyUser, swapExpiredText } from "../../bot/notify";
import {
  selfEntryCreatedText,
  selfEntryUpdatedText,
  selfEntryDeletedText,
} from "../../schedule/self-entry-notice";
import { type Env, requireAuth } from "../middleware";

/**
 * Two shapes, one per category, and `employeeId` is in NEITHER.
 *
 * It comes from the token instead. Not «ignored» and not «overwritten» —
 * absent, so there is nothing to smuggle a colleague's id through. «Кому» is the
 * single field separating this from the admin route, and a worker booking a sick
 * leave for somebody else is the whole risk of the feature.
 *
 * Narrow schemas rather than `createEntrySchema.partial()`: that one accepts
 * `templateId`, `employeeId` and all seven categories, so any future widening of
 * the admin schema would silently widen what a worker may write. Presets are the
 * admin's tool; an event is named by the words the person types.
 */
const sickBody = z.object({
  category: z.literal("sick_leave"),
  date: dateStr,
  endDate: dateStr.nullish(),
});

const eventBody = z.object({
  category: z.literal("offsite"),
  date: dateStr,
  start: timeStr,
  end: timeStr,
  title: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).nullish(),
});

const selfEntryBody = z.discriminatedUnion("category", [sickBody, eventBody]);

/** Entry rows this feature writes; the fields the two forms can produce. */
type SelfEntryBody = z.infer<typeof selfEntryBody>;

/** The row shape both write paths hand to the database, per category. */
function rowFor(body: SelfEntryBody) {
  return body.category === "sick_leave"
    ? {
        category: "sick_leave" as const,
        date: body.date,
        // `null`, not `undefined`: dropping «по какое» has to actually shorten a
        // sick leave, and `undefined` would leave the old value in place on update.
        endDate: body.endDate ?? null,
        start: null,
        end: null,
        title: null,
        location: null,
      }
    : {
        category: "offsite" as const,
        date: body.date,
        endDate: null,
        start: body.start,
        end: body.end,
        title: body.title,
        location: body.location ?? null,
      };
}

/** Worker-owned writes: sick leave and events, on oneself and nobody else. */
export function createMyEntryRoutes(deps: { db: Db; config: Config; bot?: Bot }): Hono<Env> {
  const { db, config, bot } = deps;
  const routes = new Hono<Env>();

  /** Every day the entry covers that still holds something ELSE. */
  function riskLines(employeeId: number, entry: { id: number; date: string; endDate: string | null }): string[] {
    return eachDayIso(entry.date, entry.endDate ?? entry.date)
      .map((date) => dayAfterLine(db, { employeeId, date, keepSilentForEntryId: entry.id, voice: "admins" }))
      .filter((line): line is string => line !== null);
  }

  /** Category-vs-times, category-vs-date and range coherence — the entry's own rules. */
  function shapeError(body: SelfEntryBody): string | null {
    const row = rowFor(body);
    return entryTimesError(row) ?? entryDateError(row) ?? entryRangeError(row);
  }

  routes.post("/api/my/entries", requireAuth(db, config.jwtSecret), async (c) => {
    const parsed = selfEntryBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    const body = parsed.data;
    const employeeId = c.get("auth").employeeId;
    const today = teamNow(config.teamTz).date;

    const refusal = selfEntryRefusal(body, today);
    if (refusal) return c.json({ error: refusal }, 400);
    const shape = shapeError(body);
    if (shape) return c.json({ error: shape }, 400);

    const entry = createShift(db, { ...rowFor(body), employeeId });
    recordAudit(db, "self_entry_created", employeeId, entryAuditPayload(db, entry));
    if (bot) {
      await notifyAdmins(
        bot,
        db,
        selfEntryCreatedText(nameOf(db, employeeId) ?? "Работник", entry, riskLines(employeeId, entry)),
      );
    }
    return c.json({ entry }, 201);
  });

  routes.patch("/api/my/entries/:id", requireAuth(db, config.jwtSecret), async (c) => {
    const parsed = selfEntryBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    const body = parsed.data;
    const employeeId = c.get("auth").employeeId;
    const existing = getShift(db, Number(c.req.param("id")));
    // A stranger's entry and a missing one get the same answer. Confirming that
    // somebody else's entry exists is not this worker's business, and `403` here
    // would confirm exactly that.
    if (!existing || existing.employeeId !== employeeId) return c.json({ error: "not_found" }, 404);
    // The category is not editable: sick leave and event differ in every field,
    // and «я не болею, я на конференции» is a different record, not an edit.
    if (existing.category !== body.category) return c.json({ error: "Вид записи менять нельзя" }, 400);

    const today = teamNow(config.teamTz).date;
    // BOTH rules, and this is not belt-and-braces. `selfEntryEditRefusal` asks
    // whether the OLD record may still be touched; `selfEntryRefusal` asks where
    // it is being moved TO. With only the first, an entry ending today could be
    // dragged a year out; with only the second, a sick leave that ended last
    // month could be rewritten as long as the new dates look fine.
    const editRefusal = selfEntryEditRefusal(existing, today);
    if (editRefusal) return c.json({ error: editRefusal }, 400);
    const moveRefusal = selfEntryRefusal(body, today);
    if (moveRefusal) return c.json({ error: moveRefusal }, 400);
    const shape = shapeError(body);
    if (shape) return c.json({ error: shape }, 400);

    const before = entryAuditPayload(db, existing);
    const updated = updateShift(db, existing.id, rowFor(body));
    if (!updated) return c.json({ error: "not_found" }, 404);

    recordAudit(db, "self_entry_updated", employeeId, { before, after: entryAuditPayload(db, updated) });
    if (bot) {
      await notifyAdmins(
        bot,
        db,
        selfEntryUpdatedText(nameOf(db, employeeId) ?? "Работник", existing, updated, riskLines(employeeId, updated)),
      );
    }
    return c.json({ entry: updated });
  });

  routes.delete("/api/my/entries/:id", requireAuth(db, config.jwtSecret), async (c) => {
    const employeeId = c.get("auth").employeeId;
    // Read it before it is gone — the journal has to be able to say what went.
    const existing = getShift(db, Number(c.req.param("id")));
    if (!existing || existing.employeeId !== employeeId) return c.json({ error: "not_found" }, 404);
    const refusal = selfEntryEditRefusal(existing, teamNow(config.teamTz).date);
    if (refusal) return c.json({ error: refusal }, 400);

    // Normally empty here: only `sick_leave` and `offsite` reach this line, and
    // neither is swappable, so no pending swap can point at one. Not ASSUMED
    // empty, though — an admin re-categorising a shift that already carried a
    // pending swap makes it reachable, and the admin delete route handles it.
    // Two delete paths treating one swap differently is the same class of defect
    // as two journals.
    const linesBefore = new Map(listPendingSwapsForShift(db, existing.id).map((r) => [r.id, swapAuditPayload(db, r)]));
    const { deleted, expiredSwaps } = deleteShift(db, existing.id);
    if (!deleted) return c.json({ error: "not_found" }, 404);
    recordAudit(db, "self_entry_deleted", employeeId, entryAuditPayload(db, existing));

    for (const request of expiredSwaps) {
      const payload = linesBefore.get(request.id) ?? swapAuditPayload(db, request);
      recordAudit(db, "swap_expired", employeeId, payload);
      if (!bot) continue;
      for (const side of [request.fromEmployeeId, request.toEmployeeId]) {
        const tg = getEmployeeById(db, side)?.telegramUserId ?? null;
        if (tg != null) await notifyUser(bot, tg, swapExpiredText(payload, "entry_deleted"));
      }
    }

    if (bot) {
      await notifyAdmins(bot, db, selfEntryDeletedText(nameOf(db, employeeId) ?? "Работник", existing));
    }
    return c.json({ ok: true });
  });

  return routes;
}
