import { useId, type ReactNode } from "react";

/** Настоящий `<select>` в оформлении набора: системный список выбора остаётся
 *  (он удобнее любого самодельного на телефоне), меняется только поле.
 *
 *  `label` — видимая подпись над полем, привязанная к нему через `htmlFor`:
 *  скринридер сам не свяжет текст рядом с `<select>`, а дублировать подпись в
 *  `aria-label` значило бы держать её в двух местах. Если `aria-label` задан
 *  явно — он остаётся (так делают места, где подписи на экране нет).
 *  `stretched` — на всю ширину контейнера: поле в форме не должно быть уже
 *  соседних полей и кнопок. */
export function SelectField({
  value,
  onChange,
  disabled,
  label,
  stretched,
  "aria-label": ariaLabel,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  stretched?: boolean;
  "aria-label"?: string;
  children: ReactNode;
}) {
  const id = useId();
  const field = (
    <span className={`ui-select${stretched ? " ui-select--stretched" : ""}`}>
      <select
        id={label ? id : undefined}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </span>
  );
  if (!label) return field;
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={id}>
        {label}
      </label>
      {field}
    </div>
  );
}
