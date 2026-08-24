import {
  bindThemeParamsCssVars,
  bindViewportCssVars,
  init as initSDK,
  mountThemeParamsSync,
  mountViewport,
} from "@telegram-apps/sdk-react";

/**
 * Bootstraps the Telegram SDK for this app: configures it against the
 * current launch params (real or mocked), mounts the Theme Params
 * component, and binds it to `--tg-theme-*` CSS variables so
 * `@telegram-apps/telegram-ui` renders using the native Telegram palette.
 *
 * Вторым делом монтируется viewport — ради `--tg-viewport-*-safe-area-inset-*`.
 * В полноэкранном режиме (Launch Mode = Fullscreen у BotFather) клиент рисует
 * свою шапку с «Закрыть» и «⋯» ПОВЕРХ страницы, и без этих переменных верх
 * приложения оказывается под ней: заголовок экрана перекрыт кнопками. Вне
 * полного экрана они приходят нулевыми, так что вёрстка одна на оба режима.
 */
export function init(): void {
  initSDK();

  if (mountThemeParamsSync.isAvailable()) {
    mountThemeParamsSync();
  }
  if (bindThemeParamsCssVars.isAvailable()) {
    bindThemeParamsCssVars();
  }

  // Асинхронно и без ожидания: пока клиент отвечает на запрос инсетов,
  // приложение уже рисуется — с нулевыми отступами, как рисовалось всегда.
  // Отказ клиента (старая версия, где инсетов нет вовсе) не должен ронять
  // запуск: без них приложение просто остаётся таким, каким было до fullscreen.
  if (mountViewport.isAvailable()) {
    mountViewport()
      .then(() => {
        if (bindViewportCssVars.isAvailable()) bindViewportCssVars();
      })
      .catch((error: unknown) => {
        console.warn("viewport mount failed:", error);
      });
  }
}
