/**
 * Кто уже сказал «я перевёл», а кто ещё нет.
 *
 * Правила чистые — ни базы, ни сети. Их читают сервер и обе консоли, а
 * админский список живёт в двух экранах сразу: единственный способ не дать
 * счёту разъехаться — держать его в одном месте.
 *
 * Знаменатель приходит снаружи и всегда равен списку получателей рассылки.
 * Отметка человека, которого в этом списке уже нет (уволился, отвязал
 * Telegram), молча игнорируется: иначе экран показал бы «4 из 3».
 */

/** Тот, кого просили скинуться. */
export interface PaymentRecipient {
  employeeId: number;
  displayName: string;
}

/** Строка из `collection_payments`: кто отметился и чьей рукой. */
export interface PaymentMark {
  employeeId: number;
  markedBy: number;
}

export interface PaymentRow extends PaymentRecipient {
  paid: boolean;
  /** Галочку поставил не он сам — сдавал наличкой в руки. */
  markedByAdmin: boolean;
}

export interface PaymentProgress {
  /** Все получатели, в порядке, в котором пришли. */
  rows: PaymentRow[];
  paidCount: number;
  total: number;
  /** Кого ещё ждём — то же, что `rows.filter((r) => !r.paid)`, но без него
   *  каждый вызывающий писал бы этот фильтр сам. */
  unpaid: PaymentRecipient[];
}

export function paymentProgress(
  recipients: PaymentRecipient[],
  marks: PaymentMark[],
): PaymentProgress {
  const byEmployee = new Map(marks.map((mark) => [mark.employeeId, mark]));
  const rows: PaymentRow[] = recipients.map((recipient) => {
    const mark = byEmployee.get(recipient.employeeId);
    return {
      ...recipient,
      paid: mark != null,
      markedByAdmin: mark != null && mark.markedBy !== recipient.employeeId,
    };
  });
  return {
    rows,
    paidCount: rows.filter((row) => row.paid).length,
    total: rows.length,
    unpaid: rows
      .filter((row) => !row.paid)
      .map(({ employeeId, displayName }) => ({ employeeId, displayName })),
  };
}
