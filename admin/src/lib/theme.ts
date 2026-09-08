import { useSyncExternalStore } from "react";
import { isThemeParamsDark, isThemeParamsMounted, useSignal } from "@telegram-apps/sdk-react";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Тёмный ли режим у самого браузера.
 *
 * `useSyncExternalStore`, а не `useState` с эффектом: человек переключает тему
 * системы на ходу, и подписка на медиазапрос — единственный способ узнать об
 * этом. `matchMedia` может не быть вовсе (старые движки, тесты) — тогда
 * считаем светлым, как и CSS без медиазапроса.
 */
function usePrefersDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = globalThis.matchMedia?.(DARK_QUERY);
      query?.addEventListener?.("change", onChange);
      return () => query?.removeEventListener?.("change", onChange);
    },
    () => globalThis.matchMedia?.(DARK_QUERY).matches ?? false,
    () => false,
  );
}

/**
 * Тёмная ли сейчас тема — тем же ответом, каким красит CSS.
 *
 * Внутри Telegram спрашиваем клиент. Снаружи — а консоль открывают ссылкой в
 * обычном браузере — SDK не поднимается, `--tg-theme-*` не появляются, и CSS
 * красит по `--fallback-*`, то есть по `prefers-color-scheme`. Спрашивать в
 * этом случае `isThemeParamsDark` нельзя: без темы он отвечает «тёмная»
 * всегда, и в светлом браузере всё, что красится из JS, приезжало тёмной
 * палитрой — подпись в клетке сетки имела контраст 1.22 при норме 4.5.
 *
 * Признак «Telegram здесь есть» — смонтированная тема, а не её цвет.
 */
export function useIsDark(): boolean {
  const insideTelegram = useSignal(isThemeParamsMounted);
  const telegramDark = useSignal(isThemeParamsDark);
  const browserDark = usePrefersDark();
  return insideTelegram ? telegramDark : browserDark;
}
