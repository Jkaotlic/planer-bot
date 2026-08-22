import { useEffect, useState } from "react";
import { List, Section, Spinner } from "@telegram-apps/telegram-ui";
import { checklistProgress } from "@planer/shared";
import { apiClient, type MyChecklistView } from "../api/client";

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
  const [lists, setLists] = useState<MyChecklistView[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiClient
      .getMyChecklists(today)
      .then((loaded) => { if (alive) setLists(loaded.checklists); })
      // Молча: чек-лист — не главное на этом экране, и его отказ не должен
      // выглядеть поломкой смен.
      .catch(() => { if (alive) setLists([]); });
    return () => { alive = false; };
  }, [today]);

  if (lists.length === 0) return null;

  async function toggle(itemId: number, next: boolean) {
    setBusyId(itemId);
    setError(null);
    try {
      const { checklistId, markedItemIds } = await apiClient.markChecklistItem(today, itemId, next);
      // Отметки приходят от сервера и подменяются только у своего списка:
      // у человека в день бывает два чек-листа, и ответ про один не должен
      // трогать другой.
      setLists((current) => current.map((list) => (list.id === checklistId ? { ...list, markedItemIds } : list)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить отметку");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {lists.map((list) => (
        <ChecklistSection key={list.id} list={list} busyId={busyId} error={error} onToggle={toggle} />
      ))}
    </>
  );
}

/** Один чек-лист: инструкция, пункты, счётчик. */
function ChecklistSection({
  list,
  busyId,
  error,
  onToggle,
}: {
  list: MyChecklistView;
  busyId: number | null;
  error: string | null;
  onToggle: (itemId: number, next: boolean) => void;
}) {
  const { done, total } = checklistProgress(list.items, list.markedItemIds);
  const marked = new Set(list.markedItemIds);
  const state = list;

  return (
    <List>
      <Section
        header={list.name}
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
                onClick={() => onToggle(item.id, !checked)}
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
