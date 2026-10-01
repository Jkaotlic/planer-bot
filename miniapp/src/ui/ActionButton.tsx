import type { MouseEvent, ReactNode } from "react";
import { Spinner } from "@telegram-apps/telegram-ui";

interface ActionButtonBase {
  /** primary — одно главное действие на карточку; quiet — отмена. */
  kind?: "primary" | "secondary" | "quiet";
  /** Кнопка внутри строки: ниже на вид, та же зона нажатия. */
  compact?: boolean;
  stretched?: boolean;
  /** Разрушающее действие («Удалить сбор»): красный текст, как было до набора.
   *  Синий у «удалить» читается как безобидное, а он необратим. */
  danger?: boolean;
  "aria-label"?: string;
  children: ReactNode;
}

/** Действие: `<button>` с нативным `disabled`. */
export interface ActionButtonAction extends ActionButtonBase {
  loading?: boolean;
  disabled?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Выбран ли вариант в ряду фишек; для остальных кнопок не задаётся. */
  "aria-pressed"?: boolean;
  /** Раскрыта ли секция, которой кнопка управляет: без этого скринридер читает
   *  «Показать» и не знает, что список уже открыт. */
  "aria-expanded"?: boolean;
  href?: never;
}

/** Ссылка вместо действия: тот же вид, но `<a>` — так iOS откроет `webcal://`.
 *  Занятости, `disabled` и обработчика у ссылки нет — типы не дают их задать,
 *  иначе они молча игнорировались бы. */
export interface ActionButtonLink extends ActionButtonBase {
  href: string;
  loading?: never;
  disabled?: never;
  onClick?: never;
  "aria-pressed"?: never;
  "aria-expanded"?: never;
}

export type ActionButtonProps = ActionButtonAction | ActionButtonLink;

/**
 * Своя `<button>`, а не `Button` из telegram-ui: тот кладёт подпись в `h6` с
 * `nowrap` и многоточием, и две кнопки в ряд на 390px резались до «Не с…».
 * Нативный `disabled` — он же гарантия, что погашенная кнопка не сработает.
 */
export function ActionButton({
  kind = "secondary",
  compact,
  stretched,
  danger,
  loading,
  disabled,
  onClick,
  "aria-label": ariaLabel,
  "aria-pressed": ariaPressed,
  "aria-expanded": ariaExpanded,
  href,
  children,
}: ActionButtonProps) {
  const classes = ["ui-btn", `ui-btn--${kind}`];
  if (compact) classes.push("ui-btn--compact");
  if (stretched) classes.push("ui-btn--stretched");
  if (danger) classes.push("ui-btn--danger");
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
      aria-expanded={ariaExpanded}
      onClick={onClick}
    >
      {inner}
    </button>
  );
}
