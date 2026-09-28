/**
 * Что сказать инициатору, если предложение обмена не дошло до второй стороны.
 *
 * Экран говорил «отправлено», и человек ждал ответа, которого не могло быть:
 * у коллеги нет Telegram или он заблокировал бота. Заявку тот всё равно увидит
 * в мини-аппе — об этом тоже сказано, чтобы не отменяли зря.
 */
export function swapUndeliveredNotice(notified: boolean, counterpartyName: string): string | null {
  if (notified) return null;
  return `${counterpartyName} не получит сообщение в Telegram — скажи лично. Заявку он(а) увидит в мини-аппе.`;
}
