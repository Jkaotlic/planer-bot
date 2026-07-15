import {
  bindThemeParamsCssVars,
  init as initSDK,
  mountThemeParamsSync,
} from "@telegram-apps/sdk-react";

/**
 * Bootstraps the Telegram SDK for this app: configures it against the
 * current launch params (real or mocked), mounts the Theme Params
 * component, and binds it to `--tg-theme-*` CSS variables so
 * `@telegram-apps/telegram-ui` renders using the native Telegram palette.
 */
export function init(): void {
  try {
    initSDK();

    if (mountThemeParamsSync.isAvailable()) {
      mountThemeParamsSync();
    }
    if (bindThemeParamsCssVars.isAvailable()) {
      bindThemeParamsCssVars();
    }
  } catch (err) {
    // Opened outside Telegram — e.g. the desktop console reached via the
    // bot's /admin login link in a plain browser tab. There are no Telegram
    // launch params here, so the SDK can't initialise; that's expected. The
    // app still renders using the `--fallback-*` CSS palette and signs in
    // with the browser login token instead of Telegram initData. Without
    // this guard the throw would abort before React mounts (blank page).
    console.warn("Telegram SDK init skipped (not running inside Telegram):", err);
  }
}
