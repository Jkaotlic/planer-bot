import { useState } from "react";
import { Cell, Switch } from "@telegram-apps/telegram-ui";
import { apiClient } from "../api/client";

/**
 * «Веду свой график сам» — тумблер наблюдателя, рядом с напоминаниями.
 *
 * Отдельный компонент, а не третья ветка внутри `RemindersSwitch`: тот пишет
 * `remindersEnabled`, этот — `selfScheduleEnabled`, два независимых поля на
 * одной ручке (`PATCH /api/me/settings`) с разными правами на них — сервер
 * отвечает 403 не-наблюдателю, поэтому и экран показывает тумблер только
 * наблюдателю (`me.isObserver`), не пытаясь погасить его в disabled.
 *
 * Тот же оптимистичный узор, что у `RemindersSwitch`: палец не должен ждать
 * ответа сервера, а неудача откатывает тумблер назад.
 */
export function SelfScheduleSwitch({ enabled, onChanged }: { enabled: boolean; onChanged: (next: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    onChanged(next);
    try {
      const saved = await apiClient.setSelfScheduleEnabled(next);
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
            ? "На «Моих сменах» есть форма — можно ставить себе смены самому"
            : "Смены пока ставит админ — включи, если хочешь вести свой график сам"
        }
      >
        Веду свой график сам
      </Cell>
      {error && (
        <div style={{ padding: "0 20px 10px", color: "var(--tgui--destructive_text_color)", fontSize: 13 }}>{error}</div>
      )}
    </>
  );
}
