/**
 * Чек-лист дежурного: кому он сегодня положен, сколько пройдено и как он
 * выглядит текстом.
 *
 * Правила в shared, потому что читателей трое: сервер (утренний тик решает, кому
 * писать), мини-апп (показывать карточку или нет) и консоль (сводка «кто
 * прошёл»). Один и тот же вопрос, посчитанный тремя кодами, — это три разных
 * ответа через полгода.
 */

/** Минимум, который правилам нужен от записи графика. */
export interface ChecklistEntryLike {
  date: string;
  endDate?: string | null;
  employeeId: number | null;
  templateId: number | null;
}

/** Минимум, который правилам нужен от пункта. */
export interface ChecklistItemLike {
  id: number;
  title: string;
  /** Пояснение: как именно проверять. Может не быть вовсе. */
  note?: string | null;
}

/**
 * Какие чек-листы человек проходит в этот день.
 *
 * Признак — вид смены, а не часы: «утренний дежурный» из времени не выводится
 * (07:00 бывает и у смены, а дежурство бывает вечерним), и гадать здесь значит
 * однажды прислать чек-лист не тому. Какой именно чек-лист у какого вида смены,
 * решает админ на «Видах смен».
 *
 * Множество, а не «да/нет»: у человека в один день бывает две записи разных
 * видов, и каждая приносит свой список. Порядок — как в расписании, чтобы у
 * ранней смены проверки шли первыми.
 *
 * Запись без пресета чек-листа не приносит: привязка живёт на пресете, и у
 * смены, поставленной «своим временем», взять её неоткуда.
 */
export function checklistsDueToday(
  entries: readonly ChecklistEntryLike[],
  checklistIdByTemplate: ReadonlyMap<number, number>,
  date: string,
  employeeId: number,
): number[] {
  const due: number[] = [];
  for (const entry of entries) {
    if (entry.employeeId !== employeeId) continue;
    if (entry.templateId == null) continue;
    if (entry.date > date || (entry.endDate ?? entry.date) < date) continue;
    const checklistId = checklistIdByTemplate.get(entry.templateId);
    // Один и тот же чек-лист у двух записей дня — это один чек-лист, а не два:
    // человек не проходит одни и те же пункты дважды.
    if (checklistId != null && !due.includes(checklistId)) due.push(checklistId);
  }
  return due;
}

export interface ChecklistProgress {
  done: number;
  total: number;
}

/**
 * Сколько пунктов отмечено из скольких.
 *
 * Отметки по пунктам, которых больше нет в списке, не считаются: погашенный
 * пункт из истории не пропадает, но «3 из 2» на экране читается как поломка, а
 * не как история.
 */
export function checklistProgress(
  items: readonly ChecklistItemLike[],
  markedItemIds: readonly number[],
): ChecklistProgress {
  const marked = new Set(markedItemIds);
  return { done: items.filter((item) => marked.has(item.id)).length, total: items.length };
}

/** Пустой список не «пройден»: проходить было нечего. */
export function isChecklistComplete(
  items: readonly ChecklistItemLike[],
  markedItemIds: readonly number[],
): boolean {
  const { done, total } = checklistProgress(items, markedItemIds);
  return total > 0 && done === total;
}

/**
 * Чек-лист словами — для сообщения бота.
 *
 * Пункты перечисляются целиком, а не пересказываются числом: человек читает это
 * сообщение, стоя на этаже, и «осталось 3 пункта» ему ничего не говорит.
 * Отмеченные видны отмеченными — он мог начать в мини-аппе и открыть чат.
 */
export function checklistText(
  items: readonly ChecklistItemLike[],
  markedItemIds: readonly number[],
): string {
  const marked = new Set(markedItemIds);
  const { done, total } = checklistProgress(items, markedItemIds);
  // Пояснение идёт отдельной строкой под пунктом, а не в скобках за подписью:
  // строка списка должна оставаться строкой, по которой ведут пальцем.
  const lines = items.flatMap((item) => [
    `${marked.has(item.id) ? "✅" : "◻️"} ${item.title}`,
    ...(item.note ? [`    ${item.note}`] : []),
  ]);
  return [...lines, "", `Сделано ${done} из ${total}.`].join("\n");
}

/**
 * Есть ли что рассылать по этому списку.
 *
 * Пунктов может не быть вовсе: пояснение и приложенная инструкция — уже
 * полноценное сообщение дежурному. Раньше условием была непустота списка, и у
 * «Дежурств 47», где были и пояснение, и файл, не уходило ничего и никогда
 * (2026-08-26). Молчание осталось ровно для пустоты.
 *
 * Правило считает и утренний тик, и админский экран: до этой функции экран о нём
 * не знал вовсе и обещал администратору не то, что делает бот.
 */
export function checklistHasContent(list: {
  items: readonly ChecklistItemLike[];
  note?: string | null;
  hasDoc: boolean;
}): boolean {
  return list.items.length > 0 || Boolean(list.note?.trim()) || list.hasDoc;
}

/** Уходит ли список кому-нибудь вообще — и если нет, то из-за чего. */
export type ChecklistDispatchState = "sends" | "no-templates" | "empty";

/**
 * Состояние списка глазами админа: «уходит» или «не уходит, потому что…».
 *
 * Пустота называется раньше отсутствия привязки: наполнить список придётся в
 * любом случае, а назначить его на виды смен можно и после.
 */
export function checklistDispatchState(list: {
  hasContent: boolean;
  linkedTemplateCount: number;
}): ChecklistDispatchState {
  if (!list.hasContent) return "empty";
  return list.linkedTemplateCount > 0 ? "sends" : "no-templates";
}

/**
 * Что сегодня будет с сообщением конкретному человеку.
 *
 * `muted` и `no-telegram` — те самые пропуски, которые тик делает молча: админ
 * видел «чек-лист назначен» и не мог узнать, что до половины команды он не
 * доходит.
 */
export type ChecklistDelivery = "sent" | "scheduled" | "muted" | "no-telegram" | "nothing-to-send";

export function checklistDelivery(person: {
  /** Есть ли у списка что рассылать — `checklistHasContent`. */
  sends: boolean;
  /** Пометка в `reminder_log`: за эту смену сообщение уже ушло. */
  alreadySent: boolean;
  remindersEnabled: boolean;
  hasTelegram: boolean;
}): ChecklistDelivery {
  if (!person.sends) return "nothing-to-send";
  // Факт отправки правдив и после того, как напоминания выключили: человек
  // сообщение получил, и «не уйдёт» здесь было бы враньём про прошлое.
  if (person.alreadySent) return "sent";
  // Без Telegram включать нечего — эта причина точнее выключенных напоминаний.
  if (!person.hasTelegram) return "no-telegram";
  if (!person.remindersEnabled) return "muted";
  return "scheduled";
}

/**
 * Правило рассылки словами — для админского экрана.
 *
 * Текст живёт рядом с правилом, а не в экранах: экранов два (мини-апп и
 * консоль), и порознь они разъезжаются — а неверная подпись здесь хуже её
 * отсутствия, потому что по ней принимают решение.
 */
export const CHECKLIST_RULE_TEXT =
  "Уходит в чат тому, у кого в этот день стоит смена выбранного вида, — в момент её начала " +
  "и один раз за смену. Не уйдёт тем, у кого выключены напоминания или не привязан Telegram.";

/**
 * Ответ одним словом — он же надпись на бейдже.
 *
 * Отдельно от причины, потому что на экране это две разные вещи: цветной ярлык,
 * который видно, не читая, и строка под ним для того, кто уже спросил «почему».
 */
export function checklistDispatchBadge(state: ChecklistDispatchState): string {
  return state === "sends" ? "Уходит" : "Не уходит";
}

/**
 * Строка под бейджем: кому уходит — или почему не уходит.
 *
 * Назначение называется и у пустого списка: «кому положен» и «уйдёт ли» — два
 * разных вопроса, и ответ на первый не должен пропадать из-за ответа на второй.
 */
export function checklistDispatchReason(state: ChecklistDispatchState, templateNames: readonly string[]): string {
  if (state === "sends") return templateNames.join(", ");
  if (state === "no-templates") return "не выбран вид смены";
  const empty = "ни пунктов, ни пояснения, ни файла";
  return templateNames.length > 0 ? `${empty}. Назначен: ${templateNames.join(", ")}` : `${empty}, и не выбран вид смены`;
}

/**
 * Что будет с сообщением конкретному человеку — словами.
 *
 * `start` — начало его смены: час называется прямо, потому что «утром» админ и
 * дежурный понимают по-разному. Смену ставят и «своим временем», без начала, —
 * такому тик пишет первым же проходом, и обещать час нельзя.
 */
export function checklistDeliveryLabel(
  delivery: ChecklistDelivery,
  start: string | null,
  /** Час, в который сообщение ушло, — по часам команды. */
  sentAt?: string | null,
): string {
  switch (delivery) {
    case "sent":
      // Названный час — единственный ответ на «уходило сегодня или нет», для
      // которого не нужно верить экрану на слово.
      return sentAt ? `ушло в ${sentAt}` : "уже отправлено";
    case "scheduled":
      return start ? `уйдёт в ${start}` : "уйдёт с началом смены";
    case "muted":
      return "не уйдёт: напоминания выключены";
    case "no-telegram":
      return "не уйдёт: нет Telegram";
    case "nothing-to-send":
      return "не уйдёт: в списке пусто";
  }
}

/** Сколько сегодня ушло, сколько ещё уйдёт и сколько не уйдёт вовсе. */
export interface ChecklistDayTotals {
  sent: number;
  waiting: number;
  blocked: number;
}

/**
 * Итог дня одной строкой — то, ради чего экран открывают.
 *
 * `blocked` считает вместе выключенные напоминания, отсутствие Telegram и пустой
 * список: причины разные, а следствие одно — человек сегодня ничего не получит,
 * и именно это надо увидеть, не вчитываясь в строки.
 */
export function checklistDayTotals(people: readonly { delivery: ChecklistDelivery }[]): ChecklistDayTotals {
  let sent = 0;
  let waiting = 0;
  let blocked = 0;
  for (const person of people) {
    if (person.delivery === "sent") sent += 1;
    else if (person.delivery === "scheduled") waiting += 1;
    else blocked += 1;
  }
  return { sent, waiting, blocked };
}
