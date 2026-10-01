import type { MouseEvent, ReactNode } from "react";
import { Spinner } from "@telegram-apps/telegram-ui";

export interface ActionButtonProps {
  /** primary — одно главное действие на карточку; quiet — отмена. */
  kind?: "primary" | "secondary" | "quiet";
  /** Кнопка внутри строки: ниже на вид, та же зона нажатия. */
  compact?: boolean;
  stretched?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  "aria-label"?: string;
  /** Выбран ли вариант в ряду фишек; для остальных кнопок не задаётся. */
  "aria-pressed"?: boolean;
  /** Ссылка вместо действия: тот же вид, но `<a>` — так iOS откроет `webcal://`. */
  href?: string;
  children: ReactNode;
}

/**
 * Своя `<button>`, а не `Button` из telegram-ui: тот кладёт подпись в `h6` с
 * `nowrap` и многоточием, и две кнопки в ряд на 390px резались до «Не с…».
 * Нативный `disabled` — он же гарантия, что погашенная кнопка не сработает.
 */
export function ActionButton({
  kind = "secondary",
  compact,
  stretched,
  loading,
  disabled,
  onClick,
  "aria-label": ariaLabel,
  "aria-pressed": ariaPressed,
  href,
  children,
}: ActionButtonProps) {
  const classes = ["ui-btn", `ui-btn--${kind}`];
  if (compact) classes.push("ui-btn--compact");
  if (stretched) classes.push("ui-btn--stretched");
  const inner = (
    <>
      {loading && (
        <span className="ui-btn__spinner" aria-hidden="true">
          <Spinner size="s" />
        </span>
      )}
      {children}
    </>
  );
  // У ссылки нет нативного `disabled`: гасить её нечем, поэтому `href` только
  // для кнопок, которые не бывают занятыми (см. «Добавить в календарь»).
  if (href !== undefined) {
    return (
      <a className={classes.join(" ")} href={href} aria-label={ariaLabel}>
        {inner}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={classes.join(" ")}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      onClick={onClick}
    >
      {inner}
    </button>
  );
}
