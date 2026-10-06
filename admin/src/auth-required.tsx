import { createContext, useContext } from "react";
import { AuthRequiredError } from "./api/client";

/**
 * Что делать, когда сессия истекла посреди экрана: `App` отвечает «показать вход».
 *
 * Раньше экраны писали `if (err instanceof AuthRequiredError) return;` и оставались
 * на «Загрузка…» навсегда: ошибки нет, данных нет, войти заново нечем. Один контекст
 * вместо проп-дрели через каждый экран и подэкран; без провайдера (тест экрана
 * отдельно от `App`) — пустая функция, как раньше.
 */
const AuthRequiredContext = createContext<() => void>(() => {});

export const AuthRequiredProvider = AuthRequiredContext.Provider;

export function useAuthRequired(): () => void {
  return useContext(AuthRequiredContext);
}

/**
 * `true` — это была истёкшая сессия: вход уже запрошен, больше с ошибкой делать
 * нечего (красная плашка «Сессия истекла» рядом с кнопкой только путала бы).
 */
export function routeAuthError(err: unknown, onAuthRequired: () => void): boolean {
  if (!(err instanceof AuthRequiredError)) return false;
  onAuthRequired();
  return true;
}
