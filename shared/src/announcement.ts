/**
 * Строка «не дошло» под отчётом об анонсе — для обеих консолей.
 *
 * Живёт в shared, а не на экране, по той же причине, что и `CHECKLIST_RULE_TEXT`:
 * экранов два (мини-апп и консоль), и порознь их подписи разъезжаются.
 *
 * Архивные названы числом, а не именами (его решение от 2026-09-25, ledger):
 * отчёт про рассылку — не место, где всплывает, кто из бывших сотрудников
 * когда-то был выбран получателем. У активного без Telegram имя остаётся —
 * это ныне работающий человек, и админ должен узнать, кто именно не привязан.
 */
export function announcementUnreachableLine(
  unreachable: readonly string[],
  archivedCount: number,
): string | null {
  if (unreachable.length === 0 && archivedCount <= 0) return null;
  const parts = unreachable.map((name) => `${name} (нет Telegram)`);
  if (archivedCount > 0) {
    parts.push(`ещё ${archivedCount} — в архиве`);
  }
  return `Не дошло: ${parts.join("; ")}`;
}
