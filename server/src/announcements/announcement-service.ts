import type { Bot } from "grammy";
import { addressOf } from "@planer/shared";
import type { Db } from "../db/client";
import type { Employee } from "../db/schema";
import { getEmployeeById, listActive } from "../repo/employees";
import { notifyUser } from "../bot/notify";

/**
 * Рассылка произвольного текста команде.
 *
 * Единственный поток в системе, который проходит сквозь ВСЕ настройки: и
 * `remindersEnabled`, и `notification_mutes`. Отписаться от объявлений нельзя —
 * иначе фича не даёт того, ради чего заводится. Поэтому он такой один, и поэтому
 * рассылать умеют только админы.
 */

/** Лимит Telegram — 4096, подпись отправителя съедает часть, и запас нужен на
 *  случай длинных имён. Ограничение это про сообщение, а не про базу. */
export const ANNOUNCEMENT_TEXT_MAX = 2000;

/** Один процесс обслуживает и API, и long-polling бота: тридцать сообщений ему
 *  безразличны, три тысячи — нет. Ростер команды — десятки человек, так что
 *  потолок не мешает работе и ловит только явную ошибку или злоупотребление. */
export const ANNOUNCEMENT_RECIPIENTS_MAX = 200;

export type Audience = { kind: "all" } | { kind: "picked"; employeeIds: readonly number[] };

/**
 * Без предлога «от» намеренно: он требует родительного падежа, а имя приходит
 * как есть из `addressOf` — не склонённое. «От Аня» читается как сломанный
 * русский при каждой отправке, и заводить склонятель ради одной строки
 * (отдельный модуль, длинный хвост исключений) того не стоит. Разделитель «·»
 * работает с любым именем, включая прозвища и нерусские, без падежа вообще.
 */
export function announcementText(senderName: string, text: string): string {
  return `📣 Объявление · ${senderName}\n\n${text}`;
}

/**
 * Кому уйдёт и кому не уйдёт.
 *
 * `excludedFromAssignment` НЕ исключается: это правило про раздачу смен, а не
 * про право знать новость. Отправитель исключается всегда.
 */
export function announcementRecipients(
  db: Db,
  audience: Audience,
  senderId: number,
): { reachable: Employee[]; unreachable: string[] } {
  // Архивный в `pool` при явном выборе ПОПАДАЕТ, и это не недосмотр: письмо ему
  // не уйдёт, но назвать его надо поимённо — админ, не увидевший имени в отчёте,
  // решит, что письмо ушло. `listActive` архивных не отдаёт вовсе, поэтому в
  // ветке «всем» их и нет.
  //
  // `new Set(...)` — маршрут принимает произвольный JSON от кого угодно (curl,
  // Postman, будущий клиент), и повтор id в теле не обязан быть намеренным.
  // Без дедупа человек получил бы письмо дважды, а `delivered`/`intended` и имя
  // в `unreachable` задвоились бы. Дедуп здесь, а не в маршруте: тогда защита
  // действует на оба входа функции, а не только на HTTP.
  const pool =
    audience.kind === "all"
      ? listActive(db).filter((e) => e.id !== senderId)
      : [...new Set(audience.employeeIds)]
          .map((id) => getEmployeeById(db, id))
          .filter((e): e is Employee => e != null && e.id !== senderId);

  return {
    reachable: pool.filter((e) => e.isActive && e.telegramUserId != null),
    unreachable: pool.filter((e) => !e.isActive || e.telegramUserId == null).map((e) => e.displayName),
  };
}

/**
 * Кому уйдёт объявление «всем», глазами отправителя, — с id, а не с именами.
 *
 * `announcementRecipients` отвечает на тот же вопрос, но её `unreachable` —
 * список имён: он едет в отчёт человеку, и id там не нужны. Экрану «Анонс»
 * нужны как раз id, и сверять два ответа по имени нельзя — тёзки. Поэтому
 * пул тут собирается тем же правилом, что и в ветке «всем» выше, и живёт
 * в одном файле с ним.
 */
export function announcementRoster(
  db: Db,
  senderId: number,
): { id: number; displayName: string; reachable: boolean }[] {
  return listActive(db)
    .filter((e) => e.id !== senderId)
    .map((e) => ({ id: e.id, displayName: e.displayName, reachable: e.telegramUserId != null }));
}

export async function sendAnnouncement(
  // `Bot | null | undefined`, а не `Bot | null`: маршрут отдаёт сюда `AppDeps.bot`,
  // который объявлен необязательным. Сервер поднимается и с плохим токеном.
  bot: Bot | null | undefined,
  db: Db,
  input: { senderId: number; text: string; audience: Audience },
): Promise<{ delivered: number; intended: number; unreachable: string[] }> {
  const sender = getEmployeeById(db, input.senderId);
  const { reachable, unreachable } = announcementRecipients(db, input.audience, input.senderId);
  const message = announcementText(sender ? addressOf(sender) : "администратора", input.text);

  let delivered = 0;
  for (const person of reachable) {
    if (person.telegramUserId == null) continue;
    // Один закрытый чат не обрывает рассылку: следующие в списке и есть те, до
    // кого ещё можно достучаться. Тот же приём, что в `notifyVacantSlot`.
    if (bot && (await notifyUser(bot, person.telegramUserId, message))) delivered += 1;
  }
  return { delivered, intended: reachable.length, unreachable };
}
