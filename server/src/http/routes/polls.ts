import { Hono } from "hono";
import type { Bot } from "grammy";
import { z } from "zod";
import {
  POLL_QUESTION_MAX, POLL_TELEGRAM_QUESTION_MAX, closesAtFromTime, isOpenAt, pollChoiceSchema,
  teamAudienceSchema, telegramPollConfigSchema, timeStr,
} from "@planer/shared";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { recordAudit } from "../../repo/audit";
import { resolveAudience } from "../../team/audience";
import { teamNow } from "../../util/team-time";
import { requireAuth, type Env } from "../middleware";
import { jsonBody } from "../json-body";
import {
  canManage, castVote, createPoll, getPoll, hasRecentSamePoll, listPollsFor, normalizeQuestion, pollRecipientRows, pollView,
} from "../../polls/poll-service";
import { redrawPollMessage, remindSilent, sendPollInvites } from "../../polls/poll-messenger";
import { closePollWithMessages } from "../../food/food-close";
import { deliverFoodCloseMessages } from "../../food/food-close-delivery";

/** Мини-апп показывает текст ошибки как есть — код «not_found» человеку ничего не скажет. */
const NOT_FOUND = "Опрос не найден.";

const createSchema = z.object({
  question: z.string().trim().min(1).max(POLL_TELEGRAM_QUESTION_MAX),
  closesTime: timeStr.nullable(),
  audience: teamAudienceSchema,
  telegram: telegramPollConfigSchema.optional(),
}).strict().refine((input) => input.telegram != null || input.question.length <= POLL_QUESTION_MAX, {
  path: ["question"], message: `Вопрос быстрого опроса должен быть не длиннее ${POLL_QUESTION_MAX} символов.`,
});

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
  /**
   * Опросы, которые рассылаются прямо сейчас: «кто + вопрос». Рассылка идёт
   * внутри запроса; релей обрывает долгий ответ, человек жмёт ещё раз — и
   * команда получила бы опрос дважды. Тот же замок, что `announcementsInFlight`
   * в app.ts, заведённый после таких же двойных объявлений.
   */
  const inFlight = new Set<string>();
  /** То же для «Напомнить молчащим» — по id опроса, как `remindsInFlight` у заказов. */
  const remindsInFlight = new Set<number>();
  const viewerOf = (c: { get(k: "auth"): { employeeId: number; isAdmin: boolean } }) => {
    const a = c.get("auth");
    return { id: a.employeeId, isAdmin: a.isAdmin };
  };

  app.get("/api/polls", auth, (c) =>
    c.json({ polls: listPollsFor(db, viewerOf(c), teamNow(config.teamTz)) }));

  app.post("/api/polls", auth, async (c) => {
    const parsed = createSchema.safeParse(await jsonBody(c));
    if (!parsed.success) {
      const error = parsed.error.issues.some(({ path }) => path[0] === "telegram")
        ? "Укажи разные варианты ответа для опроса Telegram."
        : "Проверь вопрос, время и адресатов.";
      return c.json({ error, issues: parsed.error.issues }, 400);
    }
    const now = teamNow(config.teamTz);
    // Время, которое сегодня уже прошло, — завтрашнее (`closesAtFromTime`): срок
    // всегда впереди, и опрос не может родиться закрытым. Поэтому отказа «время
    // уже прошло», как у заказов, здесь больше нет.
    const closesAt = closesAtFromTime(parsed.data.closesTime, now);
    if (!bot) return c.json({ error: "Бот не запущен — рассылка недоступна" }, 503);
    const viewer = viewerOf(c);
    const { reachable, unreachable } = resolveAudience(db, parsed.data.audience, viewer.id, now.date);
    if (reachable.length < 2) return c.json({ error: "Некому отправить: в списке никого, кроме тебя." }, 409);
    const key = `${viewer.id}\u0000${normalizeQuestion(parsed.data.question)}`;
    if (inFlight.has(key)) return c.json({ error: "Рассылка уже идёт — подожди." }, 409);
    // Замок живёт только пока идёт рассылка; повтор ПОСЛЕ неё (ответ потерялся
    // по дороге, а письма дошли) ловит окно по базе.
    if (hasRecentSamePoll(db, viewer.id, parsed.data.question)) {
      return c.json({ error: "Такой уже разослан пару минут назад — проверь чат." }, 409);
    }
    inFlight.add(key);
    let poll: ReturnType<typeof createPoll>;
    let delivered: number;
    try {
      poll = createPoll(db, {
        createdBy: viewer.id,
        question: parsed.data.question,
        closesAt,
        recipientIds: reachable.map((e) => e.id),
        telegram: parsed.data.telegram,
      });
      delivered = await sendPollInvites(bot, db, poll, now, config.teamTz);
    } finally {
      inFlight.delete(key);
    }
    recordAudit(db, "poll_created", viewer.id, { pollId: poll.id, question: poll.question, recipients: reachable.length, delivered });
    // В ответе — только коллеги, как у сбора: письмо самому создателю голосов не
    // соберёт, и «Отправлено коллегам: N» с ним было бы на одного больше. Журнал выше
    // хранит все письма — его `recipients` тоже считает создателя.
    const colleagues = pollRecipientRows(db, poll.id).filter((r) => r.employeeId !== viewer.id);
    const received = new Set(colleagues.filter((r) =>
      r.messageId != null && r.telegramPollId != null && r.telegramPollChatId === r.telegramUserId).map(r => r.employeeId));
    const deliveredToColleagues = poll.telegramOptions == null
      ? colleagues.filter((r) => r.messageId != null).length
      : received.size;
    const deliveryFailures = poll.telegramOptions == null ? unreachable : [...new Set([
      ...unreachable,
      ...reachable.filter(r => r.id !== viewer.id && !received.has(r.id)).map(r => r.displayName),
    ])];
    // Не дошло ни до кого из коллег — опрос всё равно остаётся (он в базе и виден в
    // мини-аппе, как сбор), но форма должна сказать это прямо, а не «Опрос отправлен».
    const deliveredToNobody = colleagues.length > 0 && deliveredToColleagues === 0;
    return c.json({
      poll: pollView(db, getPoll(db, poll.id) ?? poll, viewer, now),
      delivered: deliveredToColleagues, unreachable: deliveryFailures, deliveredToNobody,
    }, 201);
  });

  app.get("/api/polls/:id", auth, (c) => {
    const poll = getPoll(db, Number(c.req.param("id")));
    const view = poll ? pollView(db, poll, viewerOf(c), teamNow(config.teamTz)) : null;
    return view ? c.json({ poll: view }) : c.json({ error: NOT_FOUND }, 404);
  });

  app.post("/api/polls/:id/vote", auth, async (c) => {
    const body = await jsonBody(c);
    const choice = pollChoiceSchema.safeParse(body.choice);
    if (!choice.success) return c.json({ error: "Не понял голос." }, 400);
    const viewer = viewerOf(c);
    const now = teamNow(config.teamTz);
    const poll = getPoll(db, Number(c.req.param("id")));
    if (!poll || !pollView(db, poll, viewer, now)) return c.json({ error: NOT_FOUND }, 404);
    const result = castVote(db, poll, viewer.id, choice.data, now);
    if (!result.ok) return c.json({ error: result.error }, 409);
    // Письмо в чате — косметика: ответ мини-аппу её не ждёт (см. `redrawPollMessage`).
    if (bot) void redrawPollMessage(bot, db, poll, viewer.id, now);
    return c.json({ poll: pollView(db, poll, viewer, now) });
  });

  /**
   * «Напомнить молчащим» — зеркало `POST /api/orders/:id/remind`. Отказ «нельзя» —
   * 409 с причиной, как у закрытия, а не 403: 403 оба клиента читают как «сессия
   * кончилась» (консоль) и «ты не зарегистрирован» (мини-апп).
   *
   * Только идущий опрос, в отличие от заказа (там дожим — после закрытия): голос
   * закрытого уже не примут, и напоминание звало бы туда, где откажут. «Идёт» —
   * `isOpenAt`, а не `closedAt`: срок мог пройти раньше, чем тик закрыл опрос.
   */
  app.post("/api/polls/:id/remind", auth, async (c) => {
    const viewer = viewerOf(c);
    const now = teamNow(config.teamTz);
    const poll = getPoll(db, Number(c.req.param("id")));
    if (!poll || !pollView(db, poll, viewer, now)) return c.json({ error: NOT_FOUND }, 404);
    if (!canManage(poll, viewer)) return c.json({ error: "Напомнить может только тот, кто запустил опрос." }, 409);
    if (poll.cancelledAt != null) return c.json({ error: "Опрос отменён — напоминать не о чем." }, 409);
    if (!isOpenAt(poll, now)) return c.json({ error: "Опрос закрыт — напоминать уже не о чем." }, 409);
    if (!bot) return c.json({ error: "Бот не запущен — рассылка недоступна" }, 503);
    if (remindsInFlight.has(poll.id)) return c.json({ error: "Рассылка уже идёт — подожди." }, 409);
    remindsInFlight.add(poll.id);
    let outcome: Awaited<ReturnType<typeof remindSilent>>;
    try {
      outcome = await remindSilent(bot, db, poll, now);
    } finally {
      remindsInFlight.delete(poll.id);
    }
    recordAudit(db, "poll_reminded", viewer.id, { pollId: poll.id, question: poll.question, delivered: outcome.delivered, unreachable: outcome.unreachable.length });
    return c.json(outcome);
  });

  for (const action of ["close", "cancel"] as const) {
    app.post(`/api/polls/:id/${action}`, auth, async (c) => {
      const viewer = viewerOf(c);
      const now = teamNow(config.teamTz);
      const poll = getPoll(db, Number(c.req.param("id")));
      if (!poll || !pollView(db, poll, viewer, now)) return c.json({ error: NOT_FOUND }, 404);
      const result = closePollWithMessages(db, poll, viewer, action === "close" ? "closed" : "cancelled");
      if (!result.ok) return c.json({ error: result.error }, 409);
      const fresh = getPoll(db, poll.id)!;
      if (bot) await deliverFoodCloseMessages(db, bot, `poll:${poll.id}`);
      return c.json({ poll: pollView(db, fresh, viewer, now) });
    });
  }

  return app;
}
