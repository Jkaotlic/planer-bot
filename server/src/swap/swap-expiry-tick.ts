import type { Bot } from "grammy";
import { addDaysIso } from "@planer/shared";
import type { Db } from "../db/client";
import { listPendingSwapsWithDates } from "../repo/swaps";
import { setSwapStatus } from "../repo/swaps";
import { recordAudit } from "../repo/audit";
import { getEmployeeById } from "../repo/employees";
import { swapAuditPayload } from "../util/message-lines";
import { notifyUser, swapExpiredText } from "../bot/notify";

/** Сколько дней после смены заявка ещё стоит письма. Дальше — молча: в день
 *  выкатки в базе висела заявка на 25 августа, и письмо про неё через месяц
 *  читалось бы как поломка, а не как новость. */
const NOTIFY_WITHIN_DAYS = 2;

/**
 * Заявка, которую никто не тронул до того, как её смена наступила и прошла,
 * гаснет сама — без этого она годами висела бы «В ожидании», а второй
 * стороне отвечать уже нечего: смена состоялась без обмена.
 *
 * Пишет только автору (см. `swapExpiredText`): у второй стороны заявка просто
 * пропадает из входящих, а автор ждал ответа и должен узнать, что ждать
 * больше нечего. Возвращает число погашенных заявок — тик его логирует.
 */
export async function runSwapExpiryTick(db: Db, bot: Bot | null, now: { date: string; time: string }): Promise<number> {
  let expired = 0;
  for (const { request, fromDate, toDate } of listPendingSwapsWithDates(db)) {
    const earliest = fromDate < toDate ? fromDate : toDate;
    if (earliest >= now.date) continue;
    setSwapStatus(db, request.id, "expired");
    expired += 1;
    const payload = swapAuditPayload(db, request);
    recordAudit(db, "swap_expired", null, { ...payload, cause: "date_passed" });
    if (!bot || earliest < addDaysIso(now.date, -NOTIFY_WITHIN_DAYS)) continue;
    const tg = getEmployeeById(db, request.fromEmployeeId)?.telegramUserId;
    if (tg != null) await notifyUser(bot, tg, swapExpiredText(payload, "date_passed"));
  }
  return expired;
}
