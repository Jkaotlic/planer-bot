import { act } from "react";

/**
 * Ждёт условие, а не фиксированное число тиков: под нагрузкой (весь набор идёт параллельно,
 * ленивый чанк и перерисовки тянутся дольше) «пять раз по 25 мс» кончалось раньше, чем экран
 * дорисовывался, и тест падал, хотя при перепрогоне проходил.
 *
 * Условие — это сами утверждения теста: пока они не выполняются, ждём; упали по таймауту —
 * бросаем ПОСЛЕДНЮЮ их ошибку, так что строгость проверки прежняя, а сообщение настоящее.
 * Каждый шаг идёт внутри `act`, иначе React не сбросил бы обновления между попытками.
 */
export async function waitFor(assertion: () => void, timeoutMs = 10_000, intervalMs = 15): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (err) {
      if (Date.now() >= deadline) throw err;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    });
  }
}
