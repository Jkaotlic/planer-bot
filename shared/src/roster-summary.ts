/**
 * Сводка законченного импорта ростера — одна на обе консоли.
 *
 * Жила в двух копиях, и та, что в `admin/src/App.tsx`, была помечена «Mirror of
 * `summaryLine` in miniapp/…» — а зеркалом не была: в ней не было хвоста про
 * нераспознанные клетки. После файла, наставившего в сетке знаки «?», консоль
 * говорила только «CSV загружен», и предупреждение оставалось лишь в превью,
 * которое админ к этому моменту уже закрыл.
 */

/** «1 запись» / «2 записи» / «5 записей» — сводка читается по-русски, а не как лог. */
export function pluralRecords(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} записей`;
  if (mod10 === 1) return `${count} запись`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} записи`;
  return `${count} записей`;
}

export interface RosterImportOutcome {
  entriesInserted: number;
  entriesDeleted: number;
  cellsPreserved: number;
  employeesCreated: number;
  swapsExpired?: number;
  unknowns?: { name: string; date: string; code: string }[];
}

export function rosterImportSummaryLine(summary: RosterImportOutcome): string {
  const parts = [`добавлено ${pluralRecords(summary.entriesInserted)}`];
  if (summary.entriesDeleted > 0) parts.push(`заменено ${pluralRecords(summary.entriesDeleted)}`);
  if (summary.cellsPreserved > 0) parts.push(`не тронуто ${pluralRecords(summary.cellsPreserved)}`);
  if (summary.employeesCreated > 0) parts.push(`новых сотрудников — ${summary.employeesCreated}`);
  const line = `CSV загружен: ${parts.join(", ")}`;

  // Нечитаемая клетка импорт больше не останавливает, поэтому счёт обязан ехать
  // вместе с сообщением об успехе: иначе «загружено» — последнее, что сказано про
  // файл, наставивший в сетке знаки «?».
  const unreadable = summary.unknowns?.length ?? 0;
  const withUnknowns = unreadable > 0
    ? `${line}. ⚠ Не понял ${unreadable} ${unreadable === 1 ? "клетку" : "клеток"} — они стоят со знаком «?»`
    : line;

  // Перезапись месяца может погасить обмены, которых люди ещё ждали. Им пишут в
  // чат; админ, который это вызвал, должен увидеть это здесь, а не узнать от
  // человека, спрашивающего, почему его заявка «Истекла».
  const expired = summary.swapsExpired ?? 0;
  return expired > 0
    ? `${withUnknowns}. ⚠ ${expired === 1 ? "1 заявка на обмен стала неактуальной" : `${expired} заявок на обмен стали неактуальны`} — обеим сторонам написали`
    : withUnknowns;
}
