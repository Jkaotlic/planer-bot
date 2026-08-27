import { paymentProgress, type PaymentProgress } from "@planer/shared";
import type { Db } from "../db/client";
import type { Collection, Employee } from "../db/schema";
import { recipientsOf } from "./collection-service";
import { addMark, marksOf, removeMark } from "./payment-repo";

/**
 * Кто сдал, кого ждём и сколько это в цифрах.
 *
 * Знаменатель — `recipientsOf`, то есть ровно те, кому уходила рассылка. Иначе
 * «сдали 7 из 12» отвечало бы не на тот вопрос, который задают, глядя на эту
 * строку: «всем ли я написал и все ли ответили».
 */
export function listPayments(db: Db, collection: Collection): PaymentProgress {
  const recipients = recipientsOf(db, collection.employeeId).map((employee) => ({
    employeeId: employee.id,
    displayName: employee.displayName,
  }));
  return paymentProgress(recipients, marksOf(db, collection.id));
}

/**
 * Поставить или снять галочку.
 *
 * Закрытие сбора отметки замораживает: закрытый сбор — история, а не призыв
 * скинуться. Прошедший дедлайн НЕ замораживает ничего: деньги регулярно доходят
 * на день позже, и админ должен уметь дописать галочку, не переоткрывая сбор.
 *
 * Отметить можно только участника сбора. Виновник торжества им не является
 * никогда — это то же правило, по которому он не видит свой сбор нигде.
 */
export function setPaid(
  db: Db,
  collection: Collection,
  employeeId: number,
  markedBy: number,
  paid: boolean,
): { ok: true } | { ok: false; error: string } {
  if (collection.closedAt != null) {
    return { ok: false, error: "Сбор закрыт — отметки больше не меняются." };
  }
  const participates = recipientsOf(db, collection.employeeId).some((e) => e.id === employeeId);
  if (!participates) return { ok: false, error: "Этот человек в сборе не участвует." };

  if (paid) addMark(db, collection.id, employeeId, markedBy);
  else removeMark(db, collection.id, employeeId);
  return { ok: true };
}

/** Кого ещё ждём — целиком, чтобы было чем слать: нужен `telegramUserId`. */
export function unpaidRecipients(db: Db, collection: Collection): Employee[] {
  const paid = new Set(marksOf(db, collection.id).map((mark) => mark.employeeId));
  return recipientsOf(db, collection.employeeId).filter((employee) => !paid.has(employee.id));
}
