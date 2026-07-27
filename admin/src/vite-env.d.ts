/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the real API (e.g. "https://example.com"). Empty = same origin. */
  readonly VITE_API_BASE?: string;
  /** Telegram bot username without '@' (e.g. "my_shifts_bot"). */
  readonly VITE_BOT_USERNAME?: string;
}
