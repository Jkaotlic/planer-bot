import { isThemeParamsDark, isThemeParamsMounted, useSignal } from "@telegram-apps/sdk-react";

/**
 * Тёмная ли тема — тем же ответом, каким красит CSS.
 *
 * Без смонтированной темы `isThemeParamsDark` отвечает «тёмная» всегда, а токены
 * `index.css` без `--tg-theme-*` светлые. Так бывает у живых людей: старый клиент
 * Telegram не присылает `signature`, SDK на этом не поднимается, а вход всё равно
 * проходит запасным путём (`init-data.ts`). Выходил белый текст на светлом фоне,
 * контраст 1.0: не видно ни времени смены, ни имён. Браузерная тема здесь ничего
 * не решает — CSS мини-аппа на `prefers-color-scheme` не смотрит.
 */
export function useIsDark(): boolean {
  const mounted = useSignal(isThemeParamsMounted);
  const dark = useSignal(isThemeParamsDark);
  return mounted && dark;
}
