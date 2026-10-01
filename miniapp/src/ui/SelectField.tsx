import type { ReactNode } from "react";

/** Настоящий `<select>` в оформлении набора: системный список выбора остаётся
 *  (он удобнее любого самодельного на телефоне), меняется только поле. */
export function SelectField({
  value,
  onChange,
  disabled,
  "aria-label": ariaLabel,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
  children: ReactNode;
}) {
  return (
    <span className="ui-select">
      <select value={value} disabled={disabled} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </span>
  );
}
