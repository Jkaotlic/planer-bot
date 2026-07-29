/**
 * «Сегодня» / «Эта неделя» — one tap back from wherever the calendar was left.
 *
 * Styled inline rather than by class on purpose. It is rendered inside
 * `.team-range-nav`, whose own `button` rule sets `min-height: 40px` and
 * `font-size: 28px` for the chevrons; a class would lose that specificity
 * fight, and inline styles win it without a `!important` or a longer selector.
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
        minHeight: 26,
        border: 0,
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
