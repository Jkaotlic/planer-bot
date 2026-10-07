import { useEffect, useRef } from "react";
import {
  hideBackButton,
  isBackButtonMounted,
  mountBackButton,
  offBackButtonClick,
  onBackButtonClick,
  showBackButton,
} from "@telegram-apps/sdk-react";

/** Живые обработчики по порядку регистрации; последний — самый «глубокий» экран. */
const stack: Array<{ current: () => void }> = [];
let detach: (() => void) | undefined;

/** Подписка на SDK одна на всё приложение, а не одна на экран: Telegram зовёт
 *  каждого подписанного, и вложенная панель вместе с экраном под ней срабатывали
 *  бы оба — «Назад» из панели уводило бы ещё и из раздела. */
function attach(): void {
  if (detach) return;
  const listener = () => stack[stack.length - 1]?.current();
  let off: (() => void) | undefined;
  try {
    if (mountBackButton.isAvailable() && !isBackButtonMounted()) mountBackButton();
    if (showBackButton.isAvailable()) showBackButton();
    if (onBackButtonClick.isAvailable()) off = onBackButtonClick(listener);
  } catch (error: unknown) {
    console.warn("back button failed:", error);
  }
  detach = () => {
    try {
      if (off) off();
      else if (offBackButtonClick.isAvailable()) offBackButtonClick(listener);
      if (hideBackButton.isAvailable()) hideBackButton();
    } catch (error: unknown) {
      console.warn("back button cleanup failed:", error);
    }
  };
}

/**
 * Системная кнопка «Назад» Telegram ведёт туда же, куда стрелка экрана.
 *
 * Без неё системный «назад» (жест или кнопка в шапке клиента) закрывал всё
 * приложение — вместе с формой, в которой человек уже выбрал коллегу или
 * набрал сообщение. Экран, у которого есть своя стрелка, отдаёт сюда тот же
 * обработчик, и оба «назад» ведут себя одинаково — в том числе
 * предупреждают, если уйти рано.
 *
 * Обработчики складываются в стек: срабатывает тот, что зарегистрирован
 * последним. Вложенная панель внутри раздела регистрирует свой (`enabled`
 * включает его, пока панель открыта) и перехватывает «Назад» у раздела.
 *
 * Вне Telegram (dev, тесты без SDK) кнопки нет — всё под `isAvailable`, и
 * сбой SDK не роняет экран.
 */
export function useTelegramBack(handler: () => void, enabled = true): void {
  // Последний обработчик — через ref: подписка одна на весь экран, а
  // обработчик меняется с каждым рендером (замыкает свежее состояние).
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!enabled) return;
    stack.push(latest);
    attach();
    return () => {
      const at = stack.indexOf(latest);
      if (at >= 0) stack.splice(at, 1);
      if (stack.length === 0 && detach) {
        detach();
        detach = undefined;
      }
    };
  }, [enabled]);
}
