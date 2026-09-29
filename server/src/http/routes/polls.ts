import { Hono } from "hono";
import type { Bot } from "grammy";
import { z } from "zod";
import { POLL_QUESTION_MAX, closesAtFromTime, pollChoiceSchema, teamAudienceSchema, timeStr } from "@planer/shared";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { recordAudit } from "../../repo/audit";
import { resolveAudience } from "../../team/audience";
import { teamNow } from "../../util/team-time";
import { requireAuth, type Env } from "../middleware";
import { cancelPoll, castVote, closePoll, createPoll, getPoll, listPollsFor, pollView } from "../../polls/poll-service";
import { finishPollMessages, sendPollInvites } from "../../polls/poll-messenger";

const createSchema = z.object({
  question: z.string().trim().min(1).max(POLL_QUESTION_MAX),
  closesTime: timeStr.nullable(),
  audience: teamAudienceSchema,
}).strict();

/**
 * Опросы. Запускает любой работник — так он решил (2026-09-29): «кто со мной
 * на корпоратив» спрашивает не обязательно админ.
 *
 * Видимость и права — в сервисе (`pollView`, `canManage`), здесь только
 * перевод его ответов в коды: «не видишь» — 404, «видишь, но нельзя» — 409 с
 * причиной.
 */
export function createPollRoutes(deps: { db: Db; config: Config; bot?: Bot }): Hono<Env> {
  const { db, config, bot } = deps;
  const app = new Hono<Env>();
  const auth = requireAuth(db, config.jwtSecret);
  const viewerOf = (c: { get(k: "auth"): { employeeId: number; isAdmin: boolean } }) => {
    const a = c.get("auth");
    return { id: a.employeeId, isAdmin: a.isAdmin };
  };

  app.get("/api/polls", auth, (c) =>
    c.json({ polls: listPollsFor(db, viewerOf(c), teamNow(config.teamTz)) }));

  app.post("/api/polls", auth, async (c) => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Проверь вопрос, время и адресатов.", issues: parsed.error.issues }, 400);
    if (!bot) return c.json({ error: "Бот не запущен — рассылка недоступна" }, 503);
    const viewer = viewerOf(c);
    const now = teamNow(config.teamTz);
    const { reachable, unreachable } = resolveAudience(db, parsed.data.audience, viewer.id, now.date);
    if (reachable.length < 2) return c.json({ error: "Некому отправить: в списке никого, кроме тебя." }, 409);
    const poll = createPoll(db, {
      createdBy: viewer.id,
      question: parsed.data.question,
      closesAt: closesAtFromTime(parsed.data.closesTime, now.date),
      recipientIds: reachable.map((e) => e.id),
    });
    const delivered = await sendPollInvites(bot, db, poll, now);
    recordAudit(db, "poll_created", viewer.id, { pollId: poll.id, question: poll.question, recipients: reachable.length, delivered });
    return c.json({ poll: pollView(db, poll, viewer, now), delivered, unreachable }, 201);
  });

  app.get("/api/polls/:id", auth, (c) => {
    const poll = getPoll(db, Number(c.req.param("id")));
    const view = poll ? pollView(db, poll, viewerOf(c), teamNow(config.teamTz)) : null;
    return view ? c.json({ poll: view }) : c.json({ error: "not_found" }, 404);
  });

  app.post("/api/polls/:id/vote", auth, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { choice?: unknown };
    const choice = pollChoiceSchema.safeParse(body.choice);
    if (!choice.success) return c.json({ error: "choice должен быть for, against или abstain" }, 400);
    const viewer = viewerOf(c);
    const now = teamNow(config.teamTz);
    const poll = getPoll(db, Number(c.req.param("id")));
    if (!poll || !pollView(db, poll, viewer, now)) return c.json({ error: "not_found" }, 404);
    const result = castVote(db, poll, viewer.id, choice.data, now);
    if (!result.ok) return c.json({ error: result.error }, 409);
    return c.json({ poll: pollView(db, poll, viewer, now) });
  });

  for (const action of ["close", "cancel"] as const) {
    app.post(`/api/polls/:id/${action}`, auth, async (c) => {
      const viewer = viewerOf(c);
      const now = teamNow(config.teamTz);
      const poll = getPoll(db, Number(c.req.param("id")));
      if (!poll || !pollView(db, poll, viewer, now)) return c.json({ error: "not_found" }, 404);
      const result = action === "close" ? closePoll(db, poll, viewer) : cancelPoll(db, poll, viewer);
      if (!result.ok) return c.json({ error: result.error }, 409);
      const fresh = getPoll(db, poll.id)!;
      recordAudit(db, action === "close" ? "poll_closed" : "poll_cancelled", viewer.id, { pollId: poll.id, question: poll.question });
      if (bot) await finishPollMessages(bot, db, fresh, action === "close" ? "closed" : "cancelled");
      return c.json({ poll: pollView(db, fresh, viewer, now) });
    });
  }

  return app;
}
