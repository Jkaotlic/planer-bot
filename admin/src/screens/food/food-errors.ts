import { routeAuthError } from "../../auth-required";

/**
 * Текст отказа для строки рядом с действием — или `null`, если сессия истекла.
 *
 * Истёкшая сессия — не ошибка действия: исправлять в форме нечего, надо войти
 * заново. Она уходит в `onAuthRequired` (контекст `App`, как и на остальных экранах
 * консоли — один механизм `routeAuthError`), и `App` показывает вход.
 */
export function failureText(err: unknown, fallback: string, onAuthRequired: () => void): string | null {
  if (routeAuthError(err, onAuthRequired)) return null;
  return err instanceof Error && err.message ? err.message : fallback;
}
