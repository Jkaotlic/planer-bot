import { Hono } from "hono";
import { z } from "zod";
import type { Bot } from "grammy";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import type { Handover } from "../../db/schema";
import { getShift } from "../../repo/shifts";
import { getHandover } from "../../repo/handovers";
import { entryLineOf } from "../../util/message-lines";
import { handoverCandidates } from "../../handover/candidates";
import { createHandoverMessenger } from "../../handover/handover-messenger";
import { fanOut, offerTo, type HandoverDeps } from "../../handover/handover-service";
import { type Env, requireAuth } from "../middleware";

/** What the form needs to ask «кому отдать»: the shift in words, and who is free. */
export interface HandoverDraftView {
  id: number;
  shiftLine: string;
  candidates: { id: number; displayName: string }[];
}

/**
 * The second step of the sick-leave form, as data.
 *
 * Built here rather than in the mini app, for the same reason the candidate rule
 * lives on the server: a screen that offers a colleague the server would refuse
 * is a bug the person meets only after tapping.
 */
export function handoverDraftViews(db: Db, handovers: readonly Handover[]): HandoverDraftView[] {
  const views: HandoverDraftView[] = [];
  for (const handover of handovers) {
    const shift = handover.shiftId == null ? undefined : getShift(db, handover.shiftId);
    if (!shift) continue;
    views.push({
      id: handover.id,
      shiftLine: entryLineOf(shift),
      candidates: handoverCandidates(db, shift).map((employee) => ({
        id: employee.id,
        displayName: employee.displayName,
      })),
    });
  }
  return views;
}

const offerBody = z.object({ toEmployeeId: z.number().int().positive() });

/** «Кому отдать смену» — the two taps the form offers after a sick leave is saved. */
export function createMyHandoverRoutes(deps: { db: Db; config: Config; bot?: Bot }): Hono<Env> {
  const { db, config, bot } = deps;
  const routes = new Hono<Env>();
  const serviceDeps = (): HandoverDeps => ({ db, config, messenger: createHandoverMessenger(bot ?? null, db) });

  /**
   * Somebody else's handover and a missing one get the same answer.
   *
   * Confirming that a colleague's handover exists is not this worker's business,
   * and `403` would confirm exactly that — the same reasoning as the entry routes.
   */
  function mine(handoverId: number, employeeId: number): Handover | null {
    const handover = getHandover(db, handoverId);
    if (!handover || handover.fromEmployeeId !== employeeId) return null;
    return handover;
  }

  routes.post("/api/my/handovers/:id/offer", requireAuth(db, config.jwtSecret), async (c) => {
    const parsed = offerBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    const employeeId = c.get("auth").employeeId;
    const handover = mine(Number(c.req.param("id")), employeeId);
    if (!handover) return c.json({ error: "not_found" }, 404);

    const res = await offerTo(serviceDeps(), handover.id, parsed.data.toEmployeeId);
    if (!res.ok) return c.json({ error: res.reason }, 400);
    return c.json({ ok: true });
  });

  routes.post("/api/my/handovers/:id/skip", requireAuth(db, config.jwtSecret), async (c) => {
    const employeeId = c.get("auth").employeeId;
    const handover = mine(Number(c.req.param("id")), employeeId);
    if (!handover) return c.json({ error: "not_found" }, 404);

    // «Потом» is not «никому»: skipping the choice must not leave the shift
    // quietly sitting on a sick person, so it goes straight to everybody free.
    const res = await fanOut(serviceDeps(), handover.id);
    if (!res.ok) return c.json({ error: res.reason }, 400);
    return c.json({ ok: true });
  });

  return routes;
}
