/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the real API (e.g. "https://example.com"). Empty = same origin. */
  readonly VITE_API_BASE?: string;
}
