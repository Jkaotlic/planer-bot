import { useEffect, useState } from "react";
import { apiClient, AuthRequiredError, type Checklist, type ChecklistDay, type ChecklistItem, type Template } from "../api/client";
import { toISODate } from "../lib/week";

/**
 * «Чек-листы» — процедуры, которые проходят дежурные, и их сегодняшнее состояние.
 *
 * Списков несколько, а не один: у дежурного с семи и у дежурного с восьми
 * проверки разные, и «скоп смен» задаётся тем, какие виды смен на список
 * ссылаются. Привязка правится здесь же — вопрос «кто это проходит» задают
 * чек-листу, и обходить ради ответа девять карточек пресетов незачем.
 *
 * Списки приезжают пустыми в новой базе намеренно: содержимое проверки пишет
 * команда, а не этот репозиторий.
 */
export function ChecklistScreen({ templates }: { templates: readonly Template[] }) {
  const [checklists, setChecklists] = useState<Checklist[] | null>(null);
  const [day, setDay] = useState<ChecklistDay | null>(null);
  const [draft, setDraft] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = toISODate(new Date());

  async function reload() {
    try {
      const [loaded, summary] = await Promise.all([apiClient.getChecklists(), apiClient.getChecklistDay(today)]);
      setChecklists(loaded);
      setDay(summary);
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setError(err instanceof Error ? err.message : "Не удалось загрузить чек-листы");
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

  if (error && !checklists) return <div className="employees-error">{error}</div>;
  if (!checklists) return <div className="employees-empty">Загрузка…</div>;

  return (
    <div className="employees-screen">
      <div className="employees-header">
        <h2 className="employees-title">Чек-листы</h2>
      </div>

      <p className="birthday-intro">
        Проверки, которые дежурный проходит в свою смену. Списков может быть несколько — у выходящих
        в 07:00 и в 08:00 они разные. Кому какой положен, задаётся строкой «Кому положен» внутри
        списка. Пока в списке нет пунктов, бот по нему ничего не присылает.
      </p>

      {error && <div className="employees-error">{error}</div>}

      {checklists.length === 0 ? (
        <div className="employees-empty">
          Чек-листов пока нет — заведите первый, и он начнёт приходить дежурным тех видов смен, которые вы ему укажете.
        </div>
      ) : (
        <div className="employees-list">
          {checklists.map((list) => (
            <ChecklistCard
              key={list.id}
              list={list}
              templates={templates}
              open={openId === list.id}
              busy={busy}
              onToggle={() => setOpenId(openId === list.id ? null : list.id)}
              run={run}
            />
          ))}
        </div>
      )}

      <div className="field-row" style={{ marginTop: 12 }}>
        <input
          type="text"
          aria-label="Название чек-листа"
          placeholder="Например, дежурство с 07:00"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !draft.trim()) return;
            void run(() => apiClient.createChecklist(draft.trim())).then(() => setDraft(""));
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !draft.trim()}
          onClick={() => void run(() => apiClient.createChecklist(draft.trim())).then(() => setDraft(""))}
        >
          Новый чек-лист
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
            <div className="employee-row-card" key={`${person.employeeId}:${person.checklistId}`}>
              <span className="employee-row-name" title={person.displayName}>{person.displayName}</span>
              <span className="status-chip">{person.checklistName}</span>
              <span className="employee-row-spacer" />
              <span className={`status-chip${person.done >= person.total ? " status-chip-done" : ""}`}>
                {person.done} из {person.total}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChecklistCard({
  list,
  templates,
  open,
  busy,
  onToggle,
  run,
}: {
  list: Checklist;
  templates: readonly Template[];
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [itemDraft, setItemDraft] = useState("");
  const linked = templates.filter((t) => list.templateIds.includes(t.id));

  return (
    <section className="kind-card">
      <button type="button" className="kind-card-head" onClick={onToggle} aria-expanded={open}>
        <span className="kind-name">{list.name}</span>
        <span className="kind-meta">
          {list.items.length === 0 ? "пунктов нет" : `${list.items.length} п.`}
          {" · "}
          {linked.length === 0 ? "никому не назначен" : linked.map((t) => t.name).join(", ")}
        </span>
        <span className="kind-chevron">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="kind-people">
          {/* «Кому положен» — первым: это и есть тот самый «скоп смен», ради
              которого списков стало несколько. */}
          <span className="field-label">Кому положен</span>
          <div className="category-select">
            {templates.map((template) => {
              const on = list.templateIds.includes(template.id);
              return (
                <button
                  key={template.id}
                  type="button"
                  className={`category-option${on ? " selected" : ""}`}
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      apiClient.setChecklistTemplates(
                        list.id,
                        on ? list.templateIds.filter((id) => id !== template.id) : [...list.templateIds, template.id],
                      ),
                    )
                  }
                >
                  {template.name} · {template.start}
                </button>
              );
            })}
          </div>

          <span className="field-label" style={{ marginTop: 12 }}>Пункты</span>
          {list.items.length === 0 ? (
            <div className="employees-empty">Пунктов пока нет — добавьте первый.</div>
          ) : (
            <div className="employees-list">
              {list.items.map((item, index) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  index={index}
                  total={list.items.length}
                  busy={busy}
                  onRename={(title) => void run(() => apiClient.updateChecklistItem(item.id, { title }))}
                  onNote={(note) => void run(() => apiClient.updateChecklistItem(item.id, { note }))}
                  onRemove={() => void run(() => apiClient.removeChecklistItem(item.id))}
                  onMove={(to) => void run(() => apiClient.reorderChecklistItem(item.id, to))}
                />
              ))}
            </div>
          )}

          <div className="field-row" style={{ marginTop: 8 }}>
            <input
              type="text"
              aria-label={`Новый пункт в «${list.name}»`}
              placeholder="Например, обойти этаж"
              value={itemDraft}
              disabled={busy}
              onChange={(e) => setItemDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !itemDraft.trim()) return;
                void run(() => apiClient.addChecklistItem(list.id, itemDraft.trim())).then(() => setItemDraft(""));
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !itemDraft.trim()}
              onClick={() => void run(() => apiClient.addChecklistItem(list.id, itemDraft.trim())).then(() => setItemDraft(""))}
            >
              Добавить
            </button>
          </div>

          <InstructionEditor
            list={list}
            busy={busy}
            onSave={(patch) => void run(() => apiClient.patchChecklist(list.id, patch))}
            onRemoveDoc={() => void run(() => apiClient.removeChecklistDoc(list.id))}
            onUploadDoc={(file) => void run(() => apiClient.uploadChecklistDoc(list.id, file))}
          />

          <div className="panel-actions" style={{ justifyContent: "flex-start", marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => void run(() => apiClient.deleteChecklist(list.id))}
            >
              Удалить чек-лист
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Три способа дать дежурному подробности, потому что они закрывают разные
 * случаи: короткое пояснение читается прямо в чате, ссылка ведёт в живой
 * документ, который правят без нас, а файл доходит туда, где интернета может не
 * быть — он приходит в чат и остаётся в нём.
 */
function InstructionEditor({
  list,
  busy,
  onSave,
  onRemoveDoc,
  onUploadDoc,
}: {
  list: Checklist;
  busy: boolean;
  onSave: (patch: { note: string | null; docUrl: string | null }) => void;
  onRemoveDoc: () => void;
  onUploadDoc: (file: File) => void;
}) {
  const [note, setNote] = useState(list.note ?? "");
  const [docUrl, setDocUrl] = useState(list.docUrl ?? "");
  const dirty = note !== (list.note ?? "") || docUrl !== (list.docUrl ?? "");

  return (
    <div className="checklist-instruction">
      <label className="field-label" htmlFor={`checklist-note-${list.id}`}>
        Пояснение — уходит дежурному в чат вместе со списком
      </label>
      <textarea
        id={`checklist-note-${list.id}`}
        rows={4}
        value={note}
        disabled={busy}
        placeholder="Например: обход начинаем от лифтов, по часовой."
        onChange={(e) => setNote(e.target.value)}
      />

      <label className="field-label" htmlFor={`checklist-url-${list.id}`}>
        Ссылка на документ
      </label>
      <input
        id={`checklist-url-${list.id}`}
        type="url"
        value={docUrl}
        disabled={busy}
        placeholder="https://…"
        onChange={(e) => setDocUrl(e.target.value)}
      />

      <div className="panel-actions" style={{ justifyContent: "flex-start" }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !dirty}
          onClick={() => onSave({ note: note.trim() || null, docUrl: docUrl.trim() || null })}
        >
          Сохранить инструкцию
        </button>
      </div>

      {/* Файл ложится на диск сервера: браузер не умеет положить документ в
          Telegram так, чтобы бот потом мог его переслать, — пересылку берёт на
          себя бот при первой рассылке. Путь через `/instruction` остаётся
          вторым: он короче, когда файл уже в телефоне. */}
      <div className="checklist-doc">
        {list.hasDoc ? (
          <span>📄 Приложен файл: <b>{list.docName}</b> — уходит дежурному вместе с чек-листом.</span>
        ) : (
          <span>Файл не приложен.</span>
        )}
        <label className="btn btn-secondary">
          {list.hasDoc ? "📎 Заменить файл" : "📎 Приложить файл"}
          <input
            type="file"
            style={{ display: "none" }}
            disabled={busy}
            aria-label={`Приложить файл к «${list.name}»`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Значение сбрасывается: иначе повторный выбор ТОГО ЖЕ файла
              // (после неудачи) не даёт события change вовсе.
              e.target.value = "";
              if (file) onUploadDoc(file);
            }}
          />
        </label>
        {list.hasDoc && (
          <button type="button" className="btn btn-danger" disabled={busy} onClick={onRemoveDoc}>
            Убрать файл
          </button>
        )}
        <span className="checklist-doc-note">
          До 5 МБ. Можно и прислать боту: <b>/instruction</b>, потом выбрать «{list.name}».
        </span>
      </div>
    </div>
  );
}

function ItemRow({
  item,
  index,
  total,
  busy,
  onRename,
  onNote,
  onRemove,
  onMove,
}: {
  item: ChecklistItem;
  index: number;
  total: number;
  busy: boolean;
  onRename: (title: string) => void;
  onNote: (note: string | null) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(item.note ?? "");
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
        <>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setEditing(true)}>
            Переименовать
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setNoteOpen((open) => !open)}>
            {item.note ? "Пояснение ✓" : "Пояснение"}
          </button>
        </>
      )}
      {/* «Убрать», а не «Удалить»: пункт гаснет, вчерашние отметки по нему
          остаются, и слово должно обещать ровно это. */}
      <button type="button" className="btn btn-danger" disabled={busy} onClick={onRemove}>
        Убрать
      </button>

      {noteOpen && (
        <div className="checklist-item-note">
          <textarea
            rows={2}
            value={noteDraft}
            disabled={busy}
            aria-label={`Пояснение к пункту «${item.title}»`}
            placeholder="Как именно проверять"
            onChange={(e) => setNoteDraft(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || noteDraft === (item.note ?? "")}
            onClick={() => {
              onNote(noteDraft.trim() || null);
              setNoteOpen(false);
            }}
          >
            Сохранить
          </button>
        </div>
      )}
    </div>
  );
}
