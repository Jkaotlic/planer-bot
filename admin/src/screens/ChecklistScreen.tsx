import { useEffect, useState } from "react";
import { apiClient, AuthRequiredError, type ChecklistDay, type ChecklistItem } from "../api/client";
import { toISODate } from "../lib/week";

/**
 * «Чек-лист» — процедура, которую проходит дежурный, и её сегодняшнее состояние.
 *
 * Пункты пусты в новой базе намеренно: содержимое проверки пишет команда, а не
 * этот репозиторий. Пока в списке ноль пунктов, бот про чек-лист молчит и в
 * мини-аппе ничего не появляется — экран говорит об этом прямо, чтобы «ничего
 * не приходит» не выглядело поломкой.
 */
export function ChecklistScreen() {
  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [day, setDay] = useState<ChecklistDay | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = toISODate(new Date());

  async function reload() {
    try {
      const [loaded, summary] = await Promise.all([apiClient.getChecklistItems(), apiClient.getChecklistDay(today)]);
      setItems(loaded);
      setDay(summary);
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setError(err instanceof Error ? err.message : "Не удалось загрузить чек-лист");
    }
  }

  useEffect(() => {
    void reload();
    // Загружается один раз; каждая правка ниже перечитывает явно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      if (!(err instanceof AuthRequiredError)) {
        setError(err instanceof Error ? err.message : "Не удалось сохранить");
      }
    } finally {
      setBusy(false);
    }
  }

  if (error && !items) return <div className="employees-error">{error}</div>;
  if (!items) return <div className="employees-empty">Загрузка…</div>;

  return (
    <div className="employees-screen">
      <div className="employees-header">
        <h2 className="employees-title">Чек-лист</h2>
      </div>

      <p className="birthday-intro">
        Список проверок, который дежурный проходит в свою смену. Кому он положен, задаётся галочкой
        «Требует чек-лист» у вида смены на экране «Виды смен». Пока в списке нет ни одного пункта, бот
        ничего не присылает.
      </p>

      {error && <div className="employees-error">{error}</div>}

      <h3 className="birthday-group">Пункты</h3>
      {items.length === 0 ? (
        <div className="employees-empty">Пунктов пока нет — добавьте первый, и чек-лист начнёт приходить дежурным.</div>
      ) : (
        <div className="employees-list">
          {items.map((item, index) => (
            <ItemRow
              key={item.id}
              item={item}
              index={index}
              total={items.length}
              busy={busy}
              onRename={(title) => run(() => apiClient.renameChecklistItem(item.id, title))}
              onRemove={() => run(() => apiClient.removeChecklistItem(item.id))}
              onMove={(to) => run(() => apiClient.reorderChecklistItem(item.id, to))}
            />
          ))}
        </div>
      )}

      <div className="field-row" style={{ marginTop: 12 }}>
        <input
          type="text"
          aria-label="Новый пункт"
          placeholder="Например, обойти этаж"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !draft.trim()) return;
            void run(() => apiClient.addChecklistItem(draft.trim())).then(() => setDraft(""));
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !draft.trim()}
          onClick={() => void run(() => apiClient.addChecklistItem(draft.trim())).then(() => setDraft(""))}
        >
          Добавить
        </button>
      </div>

      <h3 className="birthday-group">Сегодня</h3>
      {/* Кто должен пройти и сколько уже отметил. Никаких напоминаний отсюда не
          уходит: во сколько считать день провалившимся — его решение, а не наше. */}
      {!day || day.people.length === 0 ? (
        <div className="employees-empty">Сегодня чек-лист никому не положен.</div>
      ) : (
        <div className="employees-list">
          {day.people.map((person) => (
            <div className="employee-row-card" key={person.employeeId}>
              <span className="employee-row-name" title={person.displayName}>{person.displayName}</span>
              <span className="employee-row-spacer" />
              <span className={`status-chip${person.done >= day.total ? " status-chip-done" : ""}`}>
                {person.done} из {day.total}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  index,
  total,
  busy,
  onRename,
  onRemove,
  onMove,
}: {
  item: ChecklistItem;
  index: number;
  total: number;
  busy: boolean;
  onRename: (title: string) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);

  function save() {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== item.title) onRename(next);
    else setDraft(item.title);
  }

  return (
    <div className="employee-row-card">
      <span className="checklist-order">{index + 1}</span>
      {editing ? (
        <input
          className="employee-name-input"
          type="text"
          value={draft}
          autoFocus
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setDraft(item.title);
              setEditing(false);
            }
          }}
          onBlur={save}
        />
      ) : (
        <span className="employee-row-name" title={item.title}>{item.title}</span>
      )}
      <span className="employee-row-spacer" />
      <button type="button" className="btn btn-secondary" disabled={busy || index === 0} onClick={() => onMove(index - 1)} aria-label="Выше">
        ↑
      </button>
      <button type="button" className="btn btn-secondary" disabled={busy || index === total - 1} onClick={() => onMove(index + 1)} aria-label="Ниже">
        ↓
      </button>
      {!editing && (
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setEditing(true)}>
          Переименовать
        </button>
      )}
      {/* «Убрать», а не «Удалить»: пункт гаснет, вчерашние отметки по нему
          остаются, и слово должно обещать ровно это. */}
      <button type="button" className="btn btn-danger" disabled={busy} onClick={onRemove}>
        Убрать
      </button>
    </div>
  );
}
