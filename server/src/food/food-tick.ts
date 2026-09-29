import type { Bot } from "grammy";
import { orderTotal } from "@planer/shared";
import type { Db } from "../db/client";
import { recordAudit } from "../repo/audit";
import { safeErrorMessage } from "../util/safe-error";
import { closeDuePolls, type TeamClock } from "../polls/poll-service";
import { finishPollMessages } from "../polls/poll-messenger";
import { closeDueOrders, itemsOf } from "../orders/order-service";
import { finishOrderMessages, placeName } from "../orders/order-messenger";

/**
 * Закрытие по сроку. Принимать ли голос, тик не решает — это делает
 * `isOpenAt` на каждом тапе; тик только рассылает итог. Поэтому пропущенный
 * тик стоит опоздания итога на пять минут, а не голосов после срока.
 *
 * Закрывает условным UPDATE (`closeDuePolls`), поэтому ручное закрытие в ту же
 * секунду не даст второй рассылки.
 */
export async function runFoodTick(db: Db, bot: Bot, now: TeamClock, publicUrl: string): Promise<number> {
  const closed = closeDuePolls(db, now);
  for (const poll of closed) {
    // И audit, и рассылка — в одном try: опрос уже закрыт UPDATE'ом выше, и
    // сбой на любом из двух шагов не должен стопорить цикл — иначе один
    // упавший опрос оставил бы остальные закрытыми, но без записи и без итога.
    try {
      recordAudit(db, "poll_closed", null, { pollId: poll.id, question: poll.question, byTick: true });
      await finishPollMessages(bot, db, poll, "closed");
    } catch (err) {
      console.error(`food tick: poll ${poll.id} finish failed:`, safeErrorMessage(err));
    }
  }
  const orders = closeDueOrders(db, now);
  for (const order of orders) {
    // `order` — строка ДО UPDATE'а (closeDueOrders так и возвращает): полей
    // id/createdBy/placeId/payHint это не касается, а closedAt сюда не смотрит
    // ни audit, ни рассылка.
    try {
      recordAudit(db, "order_closed", null, { orderId: order.id, placeName: placeName(db, order), total: orderTotal(itemsOf(db, order.id)), byTick: true });
      await finishOrderMessages(bot, db, order, "closed", publicUrl);
    } catch (err) {
      console.error(`food tick: order ${order.id} finish failed:`, safeErrorMessage(err));
    }
  }
  return closed.length + orders.length;
}
