import type { Bot } from "grammy";
import type { Db } from "../db/client";
import type { TeamClock } from "../polls/poll-service";
import { closeDueFoodWithMessages } from "./food-close";
import { deliverFoodCloseMessages } from "./food-close-delivery";

/** Закрываем просроченное и досылаем письма после временных отказов Telegram. */
export async function runFoodTick(db: Db, bot: Bot, now: TeamClock): Promise<number> {
  const closed = closeDueFoodWithMessages(db, now);
  await deliverFoodCloseMessages(db, bot);
  return closed;
}
