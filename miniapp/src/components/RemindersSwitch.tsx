import { useState } from "react";
import { Cell, Switch } from "@telegram-apps/telegram-ui";
import { apiClient } from "../api/client";

/**
 * «Напоминания о сменах» — the one setting a worker owns about themselves.
 *
 * Lives on «Мои смены» rather than behind a settings screen of its own: it is
 * the only setting there is, and this is the screen everyone opens. The same
 * switch is reachable from the bot (`/notifications`, and the button on every
 * reminder), because whoever wants these to stop is holding one at that moment.
 */
export function RemindersSwitch({ enabled, onChanged }: { enabled: boolean; onChanged: (next: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    // Optimistic: a switch that lags behind the finger reads as broken. The
    // catch below puts it back if the server disagreed.
    onChanged(next);
    try {
      const saved = await apiClient.setRemindersEnabled(next);
      onChanged(saved);
    } catch (err) {
      onChanged(!next);
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Cell
        Component="label"
        after={<Switch checked={enabled} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />}
        multiline
        description={
          enabled
            ? "Вечером накануне напишу про утреннюю, вечернюю и ночную смену"
            : "Про смены писать не буду — можно включить обратно в любой момент"
        }
      >
        Напоминания о сменах
      </Cell>
      {error && (
        <div style={{ padding: "0 20px 10px", color: "var(--tgui--destructive_text_color)", fontSize: 13 }}>{error}</div>
      )}
    </>
  );
}
