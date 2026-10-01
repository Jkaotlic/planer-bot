import { useEffect, useState } from "react";
import { Spinner } from "@telegram-apps/telegram-ui";
import { checklistProgress } from "@planer/shared";
import { apiClient, type MyChecklistView } from "../api/client";
import { Card, Group } from "../ui";
import { withBusy, withoutBusy } from "../lib/busy-set";

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
  // Множество, а не один id — по той же причине, что в `busy-set.ts`: ответ по
  // первому пункту отпускал кнопку второго, пока его отметка ещё летела.
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(new Set());
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
    setBusyIds((prev) => withBusy(prev, itemId));
    setError(null);
    try {
      const { checklistId, markedItemIds } = await apiClient.markChecklistItem(today, itemId, next);
      // Отметки приходят от сервера и подменяются только у своего списка:
      // у человека в день бывает два чек-листа, и ответ про один не должен
      // трогать другой. И только у своего пункта: сервер отдаёт список целиком,
      // и ответ по пункту A, пришедший позже ответа по B, не знал про B —
      // затирал его галочку на экране.
      const markedNow = markedItemIds.includes(itemId);
      setLists((current) =>
        current.map((list) => {
          if (list.id !== checklistId) return list;
          const others = list.markedItemIds.filter((id) => id !== itemId);
          return { ...list, markedItemIds: markedNow ? [...others, itemId] : others };
        }),
      );
    } catch (err) {
      setError(markErrorText(err));
    } finally {
      setBusyIds((prev) => withoutBusy(prev, itemId));
    }
  }

  return (
    <>
      {lists.map((list) => (
        <ChecklistSection key={list.id} list={list} busyIds={busyIds} error={error} onToggle={toggle} />
      ))}
    </>
  );
}

/** Один чек-лист: инструкция, пункты, счётчик. */
function ChecklistSection({
  list,
  busyIds,
  error,
  onToggle,
}: {
  list: MyChecklistView;
  busyIds: ReadonlySet<number>;
  error: string | null;
  onToggle: (itemId: number, next: boolean) => void;
}) {
  const { done, total } = checklistProgress(list.items, list.markedItemIds);
  const marked = new Set(list.markedItemIds);
  const state = list;

  return (
    <Group header={list.name} footer={done === total ? "Всё сделано — спасибо." : `Сделано ${done} из ${total}.`}>
      <Card flush>
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

        {/* Пункты и их ошибка — один блок, чтобы линия карточки не делила их. */}
        <div>
          <div className="checklist">
            {state.items.map((item) => {
              const checked = marked.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`checklist-item${checked ? " checklist-item--done" : ""}`}
                  disabled={busyIds.has(item.id)}
                  aria-pressed={checked}
                  onClick={() => onToggle(item.id, !checked)}
                >
                  <span className="checklist-item__box" aria-hidden="true">
                    {busyIds.has(item.id) ? (
                      <Spinner size="s" />
                    ) : (
                      <span className={`checklist-check${checked ? " checklist-check--on" : ""}`}>
                        {checked && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2.5 6.2 5 8.6 9.5 3.6" />
                          </svg>
                        )}
                      </span>
                    )}
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
        </div>
      </Card>
    </Group>
  );
}

/**
 * Отказ сервера на отметку — фразой, а не кодом.
 *
 * Сервер отвечает кодами (`not_your_day`, `unknown_item`, `invalid`), и они
 * уходили на экран дежурного как есть. Готовую русскую фразу (сеть и прочее)
 * пропускаем насквозь.
 */
export function markErrorText(err: unknown): string {
  const code = err instanceof Error ? err.message : "";
  switch (code) {
    case "not_your_day":
      return "Сегодня этот чек-лист не твой — обнови экран.";
    case "unknown_item":
      return "Этот пункт убрали — обнови экран.";
    case "invalid":
    case "":
      return "Не удалось сохранить отметку — попробуй ещё раз.";
    default:
      return code;
  }
}
