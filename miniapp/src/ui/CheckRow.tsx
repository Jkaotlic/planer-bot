import type { ReactNode } from "react";

/**
 * Галочка с подписью. Настоящий `<input type="checkbox">` остаётся в DOM — он
 * даёт клавиатуру, фокус и состояние скринридеру; рисуем только отметку поверх.
 * Системный квадратик в тёмной теме был серым пятном без контура.
 */
export function CheckRow({
  checked,
  onChange,
  disabled,
  label,
  hint,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: ReactNode;
  hint?: ReactNode;
  /** Когда видимая подпись («Допущен») без контекста строки ничего не говорит. */
  "aria-label"?: string;
}) {
  return (
    <label className={`ui-check${disabled ? " ui-check--disabled" : ""}`}>
      <input
        className="ui-check__input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={`ui-check__box${checked ? " ui-check__box--on" : ""}`} aria-hidden="true">
        {checked && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 6.2 5 8.6 9.5 3.6" />
          </svg>
        )}
      </span>
      <span className="ui-check__text">
        <span className="ui-check__label">{label}</span>
        {hint && <span className="ui-check__hint">{hint}</span>}
      </span>
    </label>
  );
}
