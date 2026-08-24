import { useState } from "react";
import { Cell, Select } from "@telegram-apps/telegram-ui";
import { START_TABS, startTabVisible, type StartTab } from "@planer/shared";
import { apiClient, type Me } from "../api/client";

/** Подписи вкладок — те же слова, что стоят в нижнем меню. */
const TAB_LABELS: Record<StartTab, string> = {
  mine: "Смены",
  team: "Команда — день",
  team_week: "Команда — неделя",
  swaps: "Обмены",
  weekend: "Выходные",
  collections: "Сборы",
  admin: "Админ",
};

/**
 * «С какого экрана открывать» — личная настройка рядом с напоминаниями.
 *
 * Выбор ограничен тем, что человеку видно: наблюдателю не предлагаются «Обмены»
 * и «Выходные», работнику — «Админ». Предложить экран, который потом не
 * откроется, значит соврать в настройке.
 */
export function StartTabPicker({ me, onChanged }: { me: Me; onChanged: (next: StartTab | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = START_TABS.filter((tab) => startTabVisible(tab, me));

  async function choose(next: StartTab) {
    setBusy(true);
    setError(null);
    // Оптимистично, как соседний тумблер: контрол, отстающий от пальца, читается
    // как сломанный. Откат ниже вернёт прежнее, если сервер не согласится.
    const before = me.startTab;
    onChanged(next);
    try {
      await apiClient.setStartTab(next);
    } catch (err) {
      onChanged(before);
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Cell
        Component="label"
        multiline
        description="С этого экрана приложение будет открываться. Ссылка из бота всё равно откроет то, что в ней обещано."
        after={
          <Select
            value={me.startTab ?? "mine"}
            disabled={busy}
            aria-label="Экран при открытии"
            onChange={(e) => void choose(e.target.value as StartTab)}
          >
            {options.map((tab) => (
              <option key={tab} value={tab}>
                {TAB_LABELS[tab]}
              </option>
            ))}
          </Select>
        }
      >
        Открывать сразу
      </Cell>
      {error && (
        <div style={{ padding: "0 20px 10px", color: "var(--tgui--destructive_text_color)", fontSize: 13 }}>{error}</div>
      )}
    </>
  );
}
