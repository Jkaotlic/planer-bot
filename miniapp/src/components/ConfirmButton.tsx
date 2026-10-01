import { useState } from "react";
import { ActionButton } from "../ui";

/**
 * Кнопка необратимого действия: первое нажатие спрашивает, второе делает.
 *
 * «В архив», «Удалить запись», «Удалить чек-лист», «Снять», «Не смогу»
 * срабатывали с одного тапа — а палец на телефоне промахивается. Архивация
 * снимает человека со всех будущих смен, и вернуть их «как было» нечем.
 * Тот же приём уже жил в замке обменов (`AdminSettings`), здесь он один на
 * все такие кнопки.
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
  disabled,
  loading,
  mode: _mode,
}: {
  label: string;
  /** Что именно произойдёт — одной фразой, по-человечески. */
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Оставлен ради вызовов из вкладки «Админ»; на вид больше не влияет — необратимое действие всегда обычная кнопка с переспросом. */
  mode?: "gray" | "bezeled" | "plain" | "outline";
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <ActionButton compact loading={loading} disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </ActionButton>
    );
  }
  return (
    <span role="group" aria-label={question} style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: "var(--app-text-meta)", lineHeight: 1.4, flexBasis: "100%" }}>{question}</span>
      {/* Не `primary`: на карточке уже есть главное действие («Беру»), а подтверждённый
          отказ не должен красться в его цвет и делать две «главные» кнопки. */}
      <ActionButton
        compact
        disabled={disabled}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </ActionButton>
      <ActionButton compact kind="quiet" onClick={() => setArmed(false)}>
        Отмена
      </ActionButton>
    </span>
  );
}
