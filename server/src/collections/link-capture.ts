import type { Bot } from "grammy";
import { autoSendDateFor, autoSendLabel } from "@planer/shared";
import type { Db } from "../db/client";
import type { Collection } from "../db/schema";
import { notifyUser } from "../bot/notify";
import { recordAudit } from "../repo/audit";
import { getEmployeeById } from "../repo/employees";
import { adminRecipients, updateCollection } from "./collection-service";

/**
 * Ссылка, присланная админом боту в личку, и всё, что из неё следует.
 *
 * Отдельный модуль, потому что путей два — сообщение боту и сохранение из
 * консоли, — а правило одно: есть ссылка → бот разошлёт за три дня, если не
 * выключить. Две копии этого правила означали бы два разных поведения у двух
 * входов, и объяснить команде, почему так, было бы нечем.
 */

/**
 * Ссылка в тексте сообщения, или `null`.
 *
 * Только `http(s)`: ссылка едет дальше в письме всей команде, и `javascript:`
 * или голое слово путешествовать внутри сообщения от бота не должны — то же
 * правило уже стоит на входе консоли (`collection-body.ts`).
 *
 * Хвостовая пунктуация отрезается: «держи https://example.com/s.» — обычный
 * способ прислать ссылку, а точка в конец пути не входит.
 */
export function extractUrl(text: string): string | null {
  const match = /https?:\/\/[^\s<>]+/i.exec(text);
  if (!match) return null;
  return match[0].replace(/[.,;:!?)\]}»"']+$/, "") || null;
}

/** Ставит ссылку раунду, вооружает автоотправку и пишет об этом в журнал. */
export function attachLink(
  db: Db,
  opts: { round: Collection; url: string; asOf: string; actorEmployeeId: number },
): Collection {
  const { round, url, asOf, actorEmployeeId } = opts;
  // Разосланный раунд вооружать нечем: повторной рассылки дня рождения не
  // бывает, и тик его всё равно пропустит по `sendCount > 0`. Ссылку при этом
  // менять можно и нужно — мини-приложение показывает именно её, а на руках у
  // команды может остаться протухшая.
  //
  // День считает `shared`, а не этот модуль: ту же арифметику повторяют обе
  // консоли, когда переключатель включают обратно.
  const autoSendOn =
    round.sendCount === 0 && round.celebratedOn ? autoSendDateFor(round.celebratedOn, asOf) : null;
  const result = updateCollection(db, round.id, { collectUrl: url, ...(autoSendOn ? { autoSendOn } : {}) });
  if (!result.ok) throw new Error(result.error);

  recordAudit(db, "collection_link_set", actorEmployeeId, {
    collectionId: round.id,
    employeeId: round.employeeId,
    collectUrl: url,
    autoSendOn,
  });
  return result.collection;
}

/**
 * Что видят ОСТАЛЬНЫЕ админы: сбор готов, второй заводить не надо.
 *
 * `alreadySent` — отдельная ветка, а не частный случай двух других, потому что
 * обе они пообещали бы работу, которой не будет: сам разосланный раунд не
 * уйдёт (тик пропускает его по `sendCount > 0`), а «разошлёт кто-то руками»
 * упрётся в тот же запрет повторной рассылки дня рождения. Смысл у правки
 * остаётся, и о нём и надо сказать: ссылка в мини-приложении стала свежей.
 */
export function linkReadyMessage(
  actorName: string,
  personName: string,
  autoSendOn: string | null,
  today: string,
  alreadySent = false,
): string {
  if (alreadySent) {
    return [
      `💰 ${actorName} обновил ссылку на сбор для ${personName}.`,
      "Сбор команде уже ушёл — свежую ссылку все увидят в мини-приложении.",
    ].join("\n");
  }
  const when = autoSendLabel(autoSendOn, today);
  return [
    `💰 ${actorName} вставил ссылку на сбор для ${personName}.`,
    when ? `${when} — делать ничего не надо.` : "Автоотправка выключена — разошлёт кто-то из вас руками.",
  ].join("\n");
}

/**
 * Говорит остальным админам, что ссылка появилась. Возвращает, скольким дошло.
 *
 * Тому, кто вставил, не пишем: он это и сделал. Имениннику — тем более:
 * `adminRecipients` вычитает его, как и везде в этой фиче.
 */
export async function notifyLinkReady(
  db: Db,
  bot: Bot,
  round: Collection,
  actorEmployeeId: number,
  today: string,
): Promise<number> {
  const actorName = getEmployeeById(db, actorEmployeeId)?.displayName ?? "Админ";
  const personName =
    round.employeeId != null ? (getEmployeeById(db, round.employeeId)?.displayName ?? "именинника") : "сбора";
  const text = linkReadyMessage(actorName, personName, round.autoSendOn, today, round.sendCount > 0);

  let delivered = 0;
  for (const admin of adminRecipients(db, round.employeeId)) {
    if (admin.id === actorEmployeeId) continue;
    if (await notifyUser(bot, admin.telegramUserId!, text)) delivered += 1;
  }
  return delivered;
}
