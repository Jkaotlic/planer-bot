import { useState } from "react";
import { Cell, Switch } from "@telegram-apps/telegram-ui";
import { apiClient } from "../api/client";

/**
 * «Напоминания о сменах» — личная настройка работника.
 *
 * Живёт на экране «Настройки» вместе с остальными личными: на «Сменах» она
 * тянула список вниз, а открывают этот экран ради «когда я работаю». Тот же
 * тумблер доступен из бота (`/notifications` и кнопка под каждым напоминанием),
 * потому что тот, кто хочет их отключить, держит в руках именно напоминание.
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
            ? // Перечень видов («раннюю, утреннюю, …») убран: какие именно — решает
              // админ галочкой, и работнику этот список ничего не давал, а место
              // занимал в шесть строк.
              "Вечером накануне напишу про смену"
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
