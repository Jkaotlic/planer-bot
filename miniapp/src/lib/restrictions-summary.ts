/**
 * Одна строка про ограничения работника для свёрнутой карточки: чтобы админ,
 * листая тридцать человек, видел исключённых, не раскрывая каждого.
 *
 * Берутся значения ИЗ БАЗЫ, а не «эффективные»: у наблюдателя две нижние галки
 * показывают сохранённое (человек вернётся к нему, когда роль снимут), и
 * сводка обязана говорить то же, что галки, иначе свёрнутая и раскрытая карточки
 * противоречили бы друг другу. Порядок фиксирован — он же порядок галок.
 */
export function restrictionsSummary(employee: {
  isObserver: boolean;
  excludedFromAssignment: boolean;
  excludedFromSwaps: boolean;
}): string {
  const parts: string[] = [];
  if (employee.isObserver) parts.push("наблюдатель");
  if (employee.excludedFromAssignment) parts.push("без назначений");
  if (employee.excludedFromSwaps) parts.push("без обменов");
  return parts.length > 0 ? parts.join(", ") : "нет";
}
