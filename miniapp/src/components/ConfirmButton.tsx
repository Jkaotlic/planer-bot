import { useState } from "react";
import { Button } from "@telegram-apps/telegram-ui";

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
  mode = "gray",
}: {
  label: string;
  /** Что именно произойдёт — одной фразой, по-человечески. */
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  loading?: boolean;
  mode?: "gray" | "bezeled" | "plain" | "outline";
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Button size="s" mode={mode} loading={loading} disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span role="group" aria-label={question} style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 13, lineHeight: 1.4, flexBasis: "100%" }}>{question}</span>
      <Button
        size="s"
        mode="filled"
        disabled={disabled}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button size="s" mode="plain" onClick={() => setArmed(false)}>
        Отмена
      </Button>
    </span>
  );
}
