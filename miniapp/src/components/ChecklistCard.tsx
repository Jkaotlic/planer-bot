import { useEffect, useState } from "react";
import { List, Section, Spinner } from "@telegram-apps/telegram-ui";
import { checklistProgress } from "@planer/shared";
import { apiClient, type MyChecklist } from "../api/client";

/**
 * Чек-лист дежурного во вкладке «Мои смены».
 *
 * Появляется только тогда, когда сегодня положен: сервер решает это сам
 * (`required`), а экран ничего не вычисляет — правило «кому положено» живёт в
 * одном месте и не должно повторяться здесь третьей копией.
 *
 * Отметка уходит на сервер сразу по тапу и оттуда же возвращается: держать
 * состояние галочек в экране значило бы, что закрытая мини-аппа теряет их, а
 * открытый рядом чат бота показывает другое.
 */
export function ChecklistCard({ today }: { today: string }) {
  const [state, setState] = useState<MyChecklist | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiClient
      .getMyChecklist(today)
      .then((loaded) => { if (alive) setState(loaded); })
      // Молча: чек-лист — не главное на этом экране, и его отказ не должен
      // выглядеть поломкой смен.
      .catch(() => { if (alive) setState(null); });
    return () => { alive = false; };
  }, [today]);

  if (!state?.required || state.items.length === 0) return null;

  const { done, total } = checklistProgress(state.items, state.markedItemIds);
  const marked = new Set(state.markedItemIds);

  async function toggle(itemId: number, next: boolean) {
    setBusyId(itemId);
    setError(null);
    try {
      setState(await apiClient.markChecklistItem(today, itemId, next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить отметку");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <List>
      <Section
        header="Чек-лист на сегодня"
        footer={done === total ? "Всё сделано — спасибо." : `Сделано ${done} из ${total}.`}
      >
        {/* Инструкция стоит НАД пунктами: её читают до обхода, а не после.
            Все три способа рядом, потому что закрывают разные случаи — короткий
            текст читается сразу, ссылка ведёт в живой документ, файл уже лежит
            в чате и доступен там, где интернета может не быть. */}
        {(state.note || state.docUrl || state.docName) && (
          <div className="checklist-intro">
            {state.note && <p className="checklist-intro__note">{state.note}</p>}
            {state.docUrl && (
              <a className="checklist-doc-link" href={state.docUrl} target="_blank" rel="noreferrer">
                📄 Открыть инструкцию
              </a>
            )}
            {/* Файл живёт в Telegram, и показать его здесь нечем. Молчать про
                него нельзя: человек прочитает «инструкция есть» и пойдёт искать
                её на этом экране. */}
            {state.docName && (
              <p className="checklist-intro__doc">📎 {state.docName} — в чате с ботом, вместе с утренним сообщением.</p>
            )}
          </div>
        )}

        <div className="checklist">
          {state.items.map((item) => {
            const checked = marked.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                className={`checklist-item${checked ? " checklist-item--done" : ""}`}
                disabled={busyId === item.id}
                aria-pressed={checked}
                onClick={() => void toggle(item.id, !checked)}
              >
                <span className="checklist-item__box" aria-hidden="true">
                  {busyId === item.id ? <Spinner size="s" /> : checked ? "✅" : "◻️"}
                </span>
                <span className="checklist-item__body">
                  <span className="checklist-item__title">{item.title}</span>
                  {/* Пояснение под подписью, а не в скобках за ней: строка
                      списка должна оставаться строкой, по которой ведут пальцем. */}
                  {item.note && <span className="checklist-item__note">{item.note}</span>}
                </span>
              </button>
            );
          })}
        </div>
        {error && (
          <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13, padding: "0 16px 12px" }}>{error}</div>
        )}
      </Section>
    </List>
  );
}
