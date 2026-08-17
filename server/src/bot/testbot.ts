import { Bot } from "grammy";
import type { InlineKeyboardMarkup, UserFromGetMe } from "grammy/types";

/**
 * Заготовка grammy-бота для тестов: бот, который никуда не звонит.
 *
 * Жила в 19 копиях, и это не косметика: `bot.botInfo` приходится подделывать,
 * потому что без него grammy на первом же `handleUpdate` идёт в сеть за `getMe`,
 * а `bot.api.config.use` — единственное место, где перехватывается всё, что бот
 * пытается отправить. Копии различались мелочами (id 1 или 42, `sent` или
 * `calls`, у одной — счётчик `message_id`), поэтому и не заменялись механически.
 *
 * Разделено на две функции нарочно: подделка `botInfo` одинакова у всех
 * девятнадцати, а вот ЧТО именно тест записывает — его дело, и у двух тестов
 * транспорт особый (падение на конкретном chat_id, растущий `message_id`).
 */
export function stubBotInfo<T extends Bot>(bot: T, patch: Partial<UserFromGetMe> = {}): T {
  bot.botInfo = {
    id: 42,
    is_bot: true,
    first_name: "Planer",
    username: "planer_bot",
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    ...patch,
  } as UserFromGetMe;
  return bot;
}

/** Сообщение так, как бот его отправил — то, что проверяют тесты. */
export interface SentMessage {
  chat_id: number | string;
  text: string;
  /** Кнопки под сообщением — их читают тесты про «Взять смену» и про тумблер уведомлений. */
  reply_markup?: InlineKeyboardMarkup;
}

export interface ApiCall {
  method: string;
  /**
   * Сырое тело вызова, как его отдал grammy. Намеренно нетипизировано: у
   * `sendPhoto`, `editMessageMedia` и `setMyCommands` тела разные, и тест смотрит
   * в своё — сузить это одним типом значит соврать про остальные.
   */
  payload: any;
}

export interface ApiRecorder {
  /** Каждый вызов Telegram API по порядку — включая `answerCallbackQuery`, `editMessageText`. */
  calls: ApiCall[];
  /** Только `sendMessage`, уже в удобной форме. */
  sent: SentMessage[];
  /** Тексты ответов на нажатие кнопки (`answerCallbackQuery`). */
  answers: string[];
}

/**
 * Перехватывает всё, что бот отправляет, и ничего не отправляет наружу.
 *
 * Возвращает все три записи сразу: тесту дешевле проигнорировать ненужную, чем
 * держать свою копию перехватчика ради одного массива — ровно так и появились
 * девятнадцать копий.
 */
export function recordApi(bot: Bot): ApiRecorder {
  const recorder: ApiRecorder = { calls: [], sent: [], answers: [] };
  bot.api.config.use((_prev, method, payload) => {
    recorder.calls.push({ method, payload });
    if (method === "sendMessage") recorder.sent.push(payload as unknown as SentMessage);
    if (method === "answerCallbackQuery") recorder.answers.push((payload as { text?: string }).text ?? "");
    return { ok: true, result: {} } as never;
  });
  return recorder;
}

/**
 * `callback_data` всех кнопок под сообщением, по порядку.
 *
 * Через функцию, а не чтением `reply_markup.inline_keyboard` в каждом тесте:
 * `InlineKeyboardButton` — это объединение, и `GameButton` в нём никакого
 * `callback_data` не имеет, так что прямое чтение требует каста в каждом месте.
 */
export function callbackDataOf(message: SentMessage): string[] {
  return (message.reply_markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => ("callback_data" in button ? button.callback_data : ""));
}

/** Бот без базы — для тестов, которым нужен только транспорт (`notifyUser` и его родня). */
export function silentBot(): { bot: Bot; recorder: ApiRecorder } {
  const bot = stubBotInfo(new Bot("12345:tok"));
  return { bot, recorder: recordApi(bot) };
}
