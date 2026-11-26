import { orderTotal } from "@planer/shared";
import type { Db } from "../db/client";
import type { FoodOrder, Poll } from "../db/schema";
import { recordAudit } from "../repo/audit";
import { cancelPoll, closeDuePolls, closePoll, freezeTelegramPollResult, isTelegramPollOpenAt, type TeamClock } from "../polls/poll-service";
import { queuePollCloseMessages } from "../polls/poll-messenger";
import { cancelOrder, closeDueOrders, closeOrder, itemsOf } from "../orders/order-service";
import { placeName, queueOrderCloseMessages } from "../orders/order-messenger";
import type { FoodCloseReason } from "./food-close-delivery";

type Viewer = { id: number; isAdmin: boolean };

function recordPollClose(db: Db, poll: Poll, reason: FoodCloseReason, actor: number | null): void {
  recordAudit(db, reason === "closed" ? "poll_closed" : "poll_cancelled", actor, {
    pollId: poll.id, question: poll.question, ...(actor == null ? { byTick: true } : {}),
  });
  queuePollCloseMessages(db, poll, reason);
}

function recordOrderClose(db: Db, order: FoodOrder, reason: FoodCloseReason, actor: number | null): void {
  recordAudit(db, reason === "closed" ? "order_closed" : "order_cancelled", actor, {
    orderId: order.id, placeName: placeName(db, order), total: orderTotal(itemsOf(db, order.id)),
    ...(actor == null ? { byTick: true } : {}),
  });
  queueOrderCloseMessages(db, order, reason);
}

/** Состояние и будущие письма сохраняются вместе, в том числе при остановке процесса. */
export function closePollWithMessages(db: Db, poll: Poll, viewer: Viewer, reason: FoodCloseReason, now: TeamClock) {
  return db.transaction((tx) => {
    // По истечении срока кнопка лишь запускает сверку с Telegram раньше тика.
    const manual = poll.telegramOptions != null && isTelegramPollOpenAt(poll, now);
    const result = reason === "closed" ? closePoll(tx, poll, viewer, manual ? "manual" : "deadline") : cancelPoll(tx, poll, viewer);
    if (result.ok) {
      if (reason === "closed" && manual) freezeTelegramPollResult(tx, poll.id);
      recordPollClose(tx, poll, reason, viewer.id);
    }
    return result;
  });
}

export function closeOrderWithMessages(db: Db, order: FoodOrder, viewer: Viewer, reason: FoodCloseReason) {
  return db.transaction((tx) => {
    const result = reason === "closed" ? closeOrder(tx, order, viewer) : cancelOrder(tx, order, viewer);
    if (result.ok) recordOrderClose(tx, order, reason, viewer.id);
    return result;
  });
}

export function closeDueFoodWithMessages(db: Db, now: TeamClock): number {
  return db.transaction((tx) => {
    const polls = closeDuePolls(tx, now);
    const orders = closeDueOrders(tx, now);
    for (const poll of polls) recordPollClose(tx, poll, "closed", null);
    for (const order of orders) recordOrderClose(tx, order, "closed", null);
    return polls.length + orders.length;
  });
}
