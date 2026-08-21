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
}

/**
 * Положен ли человеку чек-лист в этот день.
 *
 * Признак — вид смены, а не часы: «утренний дежурный» из времени не выводится
 * (07:00 бывает и у смены, а дежурство бывает вечерним), и гадать здесь значит
 * однажды прислать чек-лист не тому. Что считать дежурством с проверкой, решает
 * админ галочкой на пресете.
 *
 * Запись без пресета чек-листа не требует: галочка живёт на пресете, и у смены,
 * поставленной «своим временем», сказать это нечем.
 */
export function needsChecklistToday(
  entries: readonly ChecklistEntryLike[],
  templatesRequiringChecklist: ReadonlySet<number>,
  date: string,
  employeeId: number,
): boolean {
  return entries.some(
    (entry) =>
      entry.employeeId === employeeId &&
      entry.templateId != null &&
      templatesRequiringChecklist.has(entry.templateId) &&
      entry.date <= date &&
      (entry.endDate ?? entry.date) >= date,
  );
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
  const lines = items.map((item) => `${marked.has(item.id) ? "✅" : "◻️"} ${item.title}`);
  return [...lines, "", `Сделано ${done} из ${total}.`].join("\n");
}
