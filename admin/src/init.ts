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
  initSDK();

  if (mountThemeParamsSync.isAvailable()) {
    mountThemeParamsSync();
  }
  if (bindThemeParamsCssVars.isAvailable()) {
    bindThemeParamsCssVars();
  }
}
