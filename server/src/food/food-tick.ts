import type { Bot } from "grammy";
import type { Db } from "../db/client";
import { recordAudit } from "../repo/audit";
import { safeErrorMessage } from "../util/safe-error";
import { closeDuePolls, type TeamClock } from "../polls/poll-service";
import { finishPollMessages } from "../polls/poll-messenger";

/**
 * Закрытие по сроку. Принимать ли голос, тик не решает — это делает
 * `isOpenAt` на каждом тапе; тик только рассылает итог. Поэтому пропущенный
 * тик стоит опоздания итога на пять минут, а не голосов после срока.
 *
 * Закрывает условным UPDATE (`closeDuePolls`), поэтому ручное закрытие в ту же
 * секунду не даст второй рассылки.
 */
export async function runFoodTick(db: Db, bot: Bot, now: TeamClock): Promise<number> {
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
  return closed.length;
}
