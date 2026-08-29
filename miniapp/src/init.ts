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
  /**
   * Ни одна беда SDK не стоит белого экрана.
   *
   * `init()` зовётся в `main.tsx` до `createRoot`, поэтому исключение отсюда —
   * это не «тема не поднялась», а «приложение не нарисовало ни пикселя», и
   * человек видит ровно ту же пустоту, что при несовместимом бандле. Причины
   * настоящие: мини-апп открыт не из Telegram, launch-параметры не приехали,
   * клиент старее запрошенной возможности. Без SDK приложение всё ещё дойдёт
   * до `/api/auth`, получит честный отказ и скажет его словами — это лучше
   * пустоты во всех случаях.
   */
  try {
    initSDK();
  } catch (error: unknown) {
    console.warn("SDK init failed:", error);
    return;
  }

  try {
    if (mountThemeParamsSync.isAvailable()) {
      mountThemeParamsSync();
    }
    if (bindThemeParamsCssVars.isAvailable()) {
      bindThemeParamsCssVars();
    }
  } catch (error: unknown) {
    console.warn("theme params mount failed:", error);
  }

  // Асинхронно и без ожидания: пока клиент отвечает на запрос инсетов,
  // приложение уже рисуется — с нулевыми отступами, как рисовалось всегда.
  // Отказ клиента (старая версия, где инсетов нет вовсе) не должен ронять
  // запуск: без них приложение просто остаётся таким, каким было до fullscreen.
  try {
    if (mountViewport.isAvailable()) {
      mountViewport()
        .then(() => {
          if (bindViewportCssVars.isAvailable()) bindViewportCssVars();
        })
        .catch((error: unknown) => {
          console.warn("viewport mount failed:", error);
        });
    }
  } catch (error: unknown) {
    console.warn("viewport mount failed:", error);
  }
}
