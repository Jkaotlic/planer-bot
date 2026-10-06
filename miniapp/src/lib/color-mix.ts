/**
 * `color-mix()` во встроенном стиле — только через эту функцию.
 *
 * Safari до 16.2 не знает `color-mix` и выбрасывает значение целиком: у плашки
 * приветствия пропадал весь фон (белый текст на белом), у метки нехватки — заливка.
 * В CSS это лечится `@supports`, а у `style={{…}}` второй строки с запасным значением
 * не бывает, поэтому выбор делается здесь, один раз при загрузке.
 */
const supported = (() => {
  try {
    return typeof CSS !== "undefined" && typeof CSS.supports === "function"
      && CSS.supports("color", "color-mix(in srgb, red, blue)");
  } catch {
    return false;
  }
})();

/** Значение со смесью, если браузер её понимает, иначе — запасное. */
export function mixOr(withMix: string, fallback: string): string {
  return supported ? withMix : fallback;
}
