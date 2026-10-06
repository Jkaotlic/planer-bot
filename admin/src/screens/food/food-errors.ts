import { AuthRequiredError } from "../../api/client";

/**
 * Текст отказа для строки рядом с действием — или `null`, если сессия истекла.
 *
 * Истёкшая сессия — не ошибка действия: исправлять в форме нечего, надо войти
 * заново. Соседние экраны консоли глотают её молча и остаются на «Загрузка…»;
 * здесь она уходит в `App`, и тот показывает вход.
 */
export function failureText(err: unknown, fallback: string, onAuthRequired: () => void): string | null {
  if (err instanceof AuthRequiredError) {
    onAuthRequired();
    return null;
  }
  return err instanceof Error && err.message ? err.message : fallback;
}
