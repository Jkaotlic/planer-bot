import type { Bot } from "grammy";
import { COLLECTION_SEND_HOUR, collectionTitle } from "@planer/shared";
import type { Db } from "../db/client";
import { notifyUser, noticeMuteKeyboard, collectionPaidKeyboard } from "../bot/notify";
import { recordAudit } from "../repo/audit";
import { getEmployeeById } from "../repo/employees";
import {
  adminRecipients,
  claimCollectionSend,
  getCollection,
  markCollectionSent,
  previewCollection,
  recipientsOf,
  releaseCollectionSend,
} from "../collections/collection-service";
import {
  ADMIN_NOTICE_DAYS,
  adminNoticeMessage,
  adminNoticeReadyMessage,
  autoSendFailedMessage,
  autoSentMessage,
  clearAutoSent,
  ensureBirthdayRound,
  markAdminNotified,
  markAutoSent,
  markScheduleNotified,
  roundsScheduledFor,
  roundsToAutoSend,
  scheduleNoticeMessage,
  upcomingBirthdays,
} from "./birthday-service";

/**
 * Три вещи, которые бот делает про сборы сам, — в порядке самих циклов.
 *
 *   1. A week ahead of a birthday: «у Х день рождения через 7 дней».
 *   2. За три дня до дня рождения — сама рассылка сбора КОМАНДЕ.
 *   3. On the day an admin asked to be reminded — a birthday round or a custom
 *      collection alike: «пора разослать сбор по Х» / «пора дожать сбор».
 *
 * Первая и третья уходят только админам, как было с самого начала. Вторая появилась
 * 31.08.2026 и нарушает правило «бот не пишет команде сам» ровно в одном месте:
 * подарок нужен к дате, а напоминание, заставшее админа в отпуске, не рассылает
 * ничего. Цена автономии — предохранитель, и он стоит не здесь, а раньше:
 * рассылается только вооружённый раунд, а вооружается он тогда, когда админ
 * вставляет ссылку и видит и текст письма, и день. Молчащего отказа тоже быть
 * не может — про любой блокер админам уходит письмо.
 *
 * Each of the three fires once (`adminNotifiedAt` / `scheduleNotifiedAt` /
 * `autoSentAt`), so a tick that runs every five minutes doesn't turn into a
 * five-minute alarm.
 *
 * Returns how many messages went out.
 */
export async function runBirthdayNoticeTick(
  db: Db,
  bot: Bot,
  now: { date: string; time: string },
): Promise<number> {
  // Один выход на все циклы: и нудж админам, и рассылка команде — это письма
  // про сборы, и оба не должны будить людей ночью. Тот же приём, что у
  // `reminder-service.ts` с его `reminderHour`.
  if (now.time < COLLECTION_SEND_HOUR) return 0;

  const today = now.date;
  let sent = 0;

  for (const birthday of upcomingBirthdays(db, today, ADMIN_NOTICE_DAYS)) {
    const round = ensureBirthdayRound(db, birthday.employeeId, today);
    if (!round || round.adminNotifiedAt || round.sendCount > 0) continue;

    const admins = adminRecipients(db, birthday.employeeId);
    if (admins.length === 0) continue;

    // An admin who already pasted the link doesn't need to be told to create
    // one — that instruction is exactly the defect this branch guards against.
    const text = round.collectUrl
      ? adminNoticeReadyMessage(birthday.displayName, birthday.birthDateLabel, birthday.daysUntil, round.autoSendOn, today)
      : adminNoticeMessage(birthday.displayName, birthday.birthDateLabel, birthday.daysUntil, round.autoSendOn, today);
    let delivered = 0;
    // The mute button rides along even though this loop bypasses `notifyAdmins`
    // (it has its own recipient list — `adminRecipients` — not every admin).
    // The moment an admin wants "celebrations" off is exactly now, with the
    // message on screen, not whenever they happen to find the switch.
    for (const admin of admins) {
      if (await notifyUser(bot, admin.telegramUserId!, text, noticeMuteKeyboard("celebrations"))) delivered += 1;
    }

    // Mark it either way: a Telegram outage must not turn into a nag loop, and
    // the birthday is visible on the «Дни рождения» screen regardless.
    markAdminNotified(db, round.id, new Date());
    recordAudit(db, "birthday_admin_notice", null, {
      employeeId: birthday.employeeId,
      displayName: birthday.displayName,
      daysUntil: birthday.daysUntil,
      delivered,
    });
    sent += delivered;
  }

  /**
   * Единственное место, где бот пишет КОМАНДЕ без человека.
   *
   * Предохранитель стоит не здесь, а раньше: раунд вооружается только вместе со
   * ссылкой, и в момент вставки админ видел и текст письма, и день, и кнопку
   * «не рассылать сам». Здесь остаётся исполнение и громкий отказ — молчащая
   * автоотправка выглядит как «всё под контролем», а подарка не будет.
   *
   * Стоит ВЫШЕ напоминания админам намеренно. День напоминания админ выбирает
   * руками и вправе выбрать «праздник минус три» — ровно день автоотправки.
   * `roundsScheduledFor` ниже отсекает ДР-раунды по `sendCount > 0`, поэтому
   * после удавшейся рассылки «пора разослать, нажми „Разослать“» уже не уйдёт:
   * это указание упёрлось бы в 409, которым ручка отвечает на повторную
   * рассылку дня рождения. А если не ушло ни одного письма, `sendCount` остался
   * нулём — и напоминание уйдёт, потому что разослать руками снова осмысленно.
   */
  for (const stale of roundsToAutoSend(db, today)) {
    // Помечаем ДО отправки: падение посреди цикла не должно обернуться вторым
    // письмом всей команде на следующем тике. Тот же довод, что у `markAdminNotified`.
    markAutoSent(db, stale.id, new Date());

    // Перечитываем, а не работаем со снимком выборки. Замок ловит рассылку,
    // которая идёт ПРЯМО СЕЙЧАС, — но не ту, что успела закончиться между
    // выборкой и этой строкой. Рассылка первого раунда — это десятки `await` к
    // Telegram и секунды реального времени, и всё это время событийный цикл
    // свободен: ручка `/send` успевает разослать второй раунд целиком и
    // отпустить замок. По несвежему `sendCount === 0` команда получила бы про
    // него второе письмо.
    const round = getCollection(db, stale.id);
    if (!round) continue;

    // Админ успел разослать руками — это не провал, а сделанная работа.
    if (round.sendCount > 0) continue;

    const personName = round.employeeId != null ? (getEmployeeById(db, round.employeeId)?.displayName ?? null) : null;
    const admins = adminRecipients(db, round.employeeId);
    const preview = previewCollection(db, round);
    const daysUntil = round.celebratedOn ? Math.max(0, daysBetween(today, round.celebratedOn)) : 0;

    if (preview.blocker) {
      const text = autoSendFailedMessage(personName ?? "именинника", preview.blocker, daysUntil);
      for (const admin of admins) await notifyUser(bot, admin.telegramUserId!, text);
      recordAudit(db, "collection_auto_send_failed", null, {
        collectionId: round.id, employeeId: round.employeeId, title: preview.title, reason: preview.blocker,
      });
      continue;
    }

    if (!claimCollectionSend(round.id)) {
      // Замок занят — рассылает кто-то прямо сейчас, а мы даже не пробовали, и
      // отметку о попытке надо снять. С ней `roundsToAutoSend` не вернёт раунд
      // никогда: ни письма команде, ни письма админам — молчащий тупик, ровно
      // тот, что «всё под контролем, а подарка не будет». Второго письма это не
      // открывает: удавшаяся чужая рассылка ставит `sendCount`, и проверка выше
      // отсечёт раунд на следующем тике сама.
      clearAutoSent(db, round.id);
      continue;
    }
    try {
      let delivered = 0;
      // То же письмо, что уходит руками из `/send`, — и с той же кнопкой «Я перевёл».
      for (const recipient of recipientsOf(db, round.employeeId)) {
        if (await notifyUser(bot, recipient.telegramUserId!, preview.message, collectionPaidKeyboard(round.id))) delivered += 1;
      }
      if (delivered > 0) markCollectionSent(db, round.id, delivered, new Date());
      // `actorEmployeeId = null` — обе консоли уже рисуют такое как «система».
      // Отдельное событие завело бы второй способ прочитать одно и то же.
      recordAudit(db, "collection_sent", null, {
        collectionId: round.id, employeeId: round.employeeId, title: preview.title,
        // `round: 0` при нуле доставленных — тот же счёт, что у ручки `/send`:
        // `markCollectionSent` выше раунд не засчитал, и лента не должна писать
        // «Разослан сбор» про письмо, которого никто не получил.
        round: delivered > 0 ? 1 : 0, delivered, intended: preview.recipients.length, auto: true,
      });

      const report = delivered > 0
        ? autoSentMessage(personName ?? "именинника", delivered, preview.recipients.length)
        : autoSendFailedMessage(personName ?? "именинника", "Telegram не принял ни одного письма.", daysUntil);
      // Ноль доставленных — это провал, а не тихий успех: `markCollectionSent`
      // выше его не засчитал, и админ обязан узнать об этом словами.
      for (const admin of admins) await notifyUser(bot, admin.telegramUserId!, report);
      sent += delivered;
    } finally {
      releaseCollectionSend(round.id);
    }
  }

  for (const round of roundsScheduledFor(db, today)) {
    // A general fundraiser has no honouree at all — `employeeId` is null, and
    // `adminRecipients(db, null)` correctly reads as "all reachable admins".
    const personName = round.employeeId != null ? (getEmployeeById(db, round.employeeId)?.displayName ?? null) : null;
    const admins = adminRecipients(db, round.employeeId);
    if (admins.length === 0) continue;

    const title = collectionTitle(round, personName);
    const text = scheduleNoticeMessage(title, round.collectUrl, round.kind);
    let delivered = 0;
    // See the same button above — a general collection round is `celebrations`
    // too, so the same switch covers it.
    //
    // Рядом с ним — «Собрали, закрыть»: это письмо и есть просьба дожать сбор, и
    // ответ на неё должен быть здесь же, а не в мини-аппе, куда за ним надо идти.
    // Клавиатура собирается заново на каждого адресата: `InlineKeyboard`
    // мутабелен, и общий экземпляр копил бы по кнопке на админа.
    for (const admin of admins) {
      const keyboard = noticeMuteKeyboard("celebrations").row().text("✅ Собрали, закрыть", `collection:close:${round.id}`);
      if (await notifyUser(bot, admin.telegramUserId!, text, keyboard)) delivered += 1;
    }

    // Marked either way: a Telegram outage must not become a nag loop. The date
    // is still on the screen.
    markScheduleNotified(db, round.id, new Date());
    // Event type stays `birthday_schedule_notice` even for a custom collection:
    // renaming it would orphan the journal rows already written in production.
    recordAudit(db, "birthday_schedule_notice", null, {
      employeeId: round.employeeId,
      displayName: personName,
      title,
      scheduledSendOn: round.scheduledSendOn,
      delivered,
    });
    sent += delivered;
  }

  return sent;
}

/** Сколько дней от `from` до `to`, обе — YYYY-MM-DD. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
