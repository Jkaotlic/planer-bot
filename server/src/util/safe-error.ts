const TELEGRAM_BOT_CREDENTIAL = /\bbot\d{6,}:[A-Za-z0-9_-]{20,}/g;

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(TELEGRAM_BOT_CREDENTIAL, "bot[REDACTED_BOT_TOKEN]")
    .replace(/\s+/g, " ")
    .trim();
}
