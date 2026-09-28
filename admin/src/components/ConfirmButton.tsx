import { useState } from "react";

/**
 * Кнопка необратимого действия: первое нажатие спрашивает, второе делает.
 * Зеркало `miniapp/src/components/ConfirmButton.tsx` — у консоли свои кнопки.
 *
 * «Архивировать» и «Удалить чек-лист» срабатывали с одного клика; архивация
 * снимает человека со всех будущих смен, и вернуть их «как было» нечем.
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
  disabled,
  className = "btn btn-secondary",
}: {
  label: string;
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <span role="group" aria-label={question} style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 13 }}>{question}</span>
      <button
        type="button"
        className="btn btn-danger"
        disabled={disabled}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => setArmed(false)}>
        Отмена
      </button>
    </span>
  );
}
