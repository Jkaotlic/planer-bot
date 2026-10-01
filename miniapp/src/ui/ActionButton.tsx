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
  children,
}: ActionButtonProps) {
  const classes = ["ui-btn", `ui-btn--${kind}`];
  if (compact) classes.push("ui-btn--compact");
  if (stretched) classes.push("ui-btn--stretched");
  return (
    <button
      type="button"
      className={classes.join(" ")}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {loading && (
        <span className="ui-btn__spinner" aria-hidden="true">
          <Spinner size="s" />
        </span>
      )}
      {children}
    </button>
  );
}
