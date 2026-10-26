/**
 * Every refusal `assignSlot` returns. Lives in shared, not next to the service,
 * because the dev mocks of both consoles refuse with the same words, and the
 * text table below has to cover every code: a new code without a phrase fails
 * `tsc` instead of reaching the admin's screen as «not_open».
 */
export type AssignReason =
  | "not_found"
  | "not_open"
  | "slot_passed"
  | "not_weekend"
  | "not_active"
  | "excluded"
  | "not_interested"
  | "busy";

/**
 * Фразы отказа «Назначить». Обе консоли показывают `error` ответа как есть, так
 * что сырой код здесь — это то, что админ прочтёт. Каждая фраза говорит, что
 * случилось, а не «ошибка»: админ должен понять, что делать дальше.
 * `busy` — отдельно (`weekendBusyRefusal`): ему нужны имя и мешающая запись.
 */
export const ASSIGN_REFUSAL_TEXT: Record<Exclude<AssignReason, "busy">, string> = {
  not_found: "Этого слота больше нет — обнови список",
  not_open: "Набор на этот слот уже закрыт",
  slot_passed: "Этот день уже прошёл",
  // Календарь мог перенести рабочий день на субботу уже после публикации слота.
  not_weekend: "По календарю этот день теперь рабочий — работу в выходной на него не поставить",
  not_active: "Этот человек в архиве",
  excluded: "Этот человек выведен из назначений",
  // И «не откликался», и «откликнулся, потом передумал» — одна правда: его нет в списке.
  not_interested: "Этого человека нет среди желающих на этот слот",
};

/**
 * Отказ назначить занятого человека. Имя стоит первым, в именительном: «У Игорь
 * Петров…» требовало бы родительного падежа, а склонять имена неоткуда.
 * `entryLine` — строка `entryLineOf` мешающей записи.
 */
export function weekendBusyRefusal(name: string, entryLine: string): string {
  return `${name} в это время уже занят(а): ${entryLine}`;
}
