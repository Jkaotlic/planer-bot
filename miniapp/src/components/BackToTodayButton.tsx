/**
 * «Сегодня» / «Эта неделя» — один тап назад, откуда бы ни листали календарь.
 *
 * Стили встроены, а не классом, намеренно: кнопка стоит внутри
 * `.team-range-nav`, чьё правило `button` задаёт `min-height: 40px` и
 * `font-size: 28px` для шевронов; класс проиграл бы в споре специфичности, а
 * встроенный стиль выигрывает его без `!important` и без более длинного
 * селектора.
 *
 * Нарисована таблеткой в 26px, а зона нажатия — 44px: сверху и снизу лежит
 * прозрачная рамка по 9px, фон обрезан по `padding-box`, а отрицательный
 * `margin` возвращает строке прежнюю высоту. Вид не меняется, палец не промахивается.
 */
export function BackToTodayButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        minHeight: "var(--app-tap)",
        margin: "-9px 0",
        border: "9px solid transparent",
        borderInline: 0,
        backgroundClip: "padding-box",
        borderRadius: 999,
        padding: "0 12px",
        fontSize: 12.5,
        fontWeight: 600,
        lineHeight: "26px",
        whiteSpace: "nowrap",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        color: "var(--tgui--button_text_color)",
        background: "var(--tgui--button_color)",
      }}
    >
      ↩ {label}
    </button>
  );
}
