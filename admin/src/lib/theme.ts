import { isThemeParamsDark, useSignal } from "@telegram-apps/sdk-react";

/**
 * Reactively reflects the current Telegram theme's light/dark-ness, driven
 * by the same signal that picks `<AppRoot appearance>` in `main.tsx`.
 */
export function useIsDark(): boolean {
  return useSignal(isThemeParamsDark);
}
