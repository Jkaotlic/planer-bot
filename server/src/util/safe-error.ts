const TELEGRAM_BOT_CREDENTIAL = /\bbot\d{6,}:[A-Za-z0-9_-]{20,}/g;

/** Сам редактор, отдельно от склейки в одну строку: дампу падения нужен стек
 *  с переводами строк, и он берёт эту функцию (см. `fatal-log.ts`). */
export function redactSecrets(text: string): string {
  return text.replace(TELEGRAM_BOT_CREDENTIAL, "bot[REDACTED_BOT_TOKEN]");
}

/**
 * Сетевой отказ grammY (`HttpError`) говорит только «Network request for
 * 'sendMessage' failed!», а почему — лежит в `.error`. Без этого пять сбоев за
 * сентябрь выглядели в логе одинаково, и `ENOTFOUND api.telegram.org` пришлось
 * выкапывать из единственного старого дампа. Причину несёт полный URL с токеном —
 * поэтому склейка идёт ДО редактора.
 */
function causeOf(error: Error): string | undefined {
  const inner = (error as { error?: unknown }).error ?? error.cause;
  if (inner instanceof Error) return inner.message;
  return undefined;
}

export function safeErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? causeOf(error) : undefined;
  if (cause) message = `${message} (${cause})`;
  return redactSecrets(message).replace(/\s+/g, " ").trim();
}
