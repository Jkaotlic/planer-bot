const TELEGRAM_BOT_CREDENTIAL = /\bbot\d{6,}:[A-Za-z0-9_-]{20,}/g;

/** Сам редактор, отдельно от склейки в одну строку: дампу падения нужен стек
 *  с переводами строк, и он берёт эту функцию (см. `fatal-log.ts`). */
export function redactSecrets(text: string): string {
  return text.replace(TELEGRAM_BOT_CREDENTIAL, "bot[REDACTED_BOT_TOKEN]");
}

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message).replace(/\s+/g, " ").trim();
}
