import { useEffect, useRef } from "react";
import {
  hideBackButton,
  isBackButtonMounted,
  mountBackButton,
  offBackButtonClick,
  onBackButtonClick,
  showBackButton,
} from "@telegram-apps/sdk-react";

/**
 * Системная кнопка «Назад» Telegram ведёт туда же, куда стрелка экрана.
 *
 * Без неё системный «назад» (жест или кнопка в шапке клиента) закрывал всё
 * приложение — вместе с формой, в которой человек уже выбрал коллегу или
 * набрал сообщение. Экран, у которого есть своя стрелка, отдаёт сюда тот же
 * обработчик, и оба «назад» ведут себя одинаково — в том числе
 * предупреждают, если уйти рано.
 *
 * Вне Telegram (dev, тесты без SDK) кнопки нет — всё под `isAvailable`, и
 * сбой SDK не роняет экран.
 */
export function useTelegramBack(handler: () => void): void {
  // Последний обработчик — через ref: подписка одна на весь экран, а
  // обработчик меняется с каждым рендером (замыкает свежее состояние).
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    const listener = () => latest.current();
    let off: (() => void) | undefined;
    try {
      if (mountBackButton.isAvailable() && !isBackButtonMounted()) mountBackButton();
      if (showBackButton.isAvailable()) showBackButton();
      if (onBackButtonClick.isAvailable()) off = onBackButtonClick(listener);
    } catch (error: unknown) {
      console.warn("back button failed:", error);
    }
    return () => {
      try {
        if (off) off();
        else if (offBackButtonClick.isAvailable()) offBackButtonClick(listener);
        if (hideBackButton.isAvailable()) hideBackButton();
      } catch (error: unknown) {
        console.warn("back button cleanup failed:", error);
      }
    };
  }, []);
}
