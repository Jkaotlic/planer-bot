import { useEffect, useState } from "react";
import { filterPeople, RECIPIENT_GROUP_NAME_MAX } from "@planer/shared";
import { apiClient, AuthRequiredError, type Employee, type RecipientGroupView } from "../api/client";
import { ConfirmButton } from "../components/ConfirmButton";
import { PersonSearch } from "../components/PersonSearch";

/**
 * «Группы» — списки людей, которые админ правит сам и потом выбирает одной
 * кнопкой в рассылках («ЧИП 5-й этаж»). Двойник `miniapp/.../AdminGroups.tsx`.
 *
 * Состав правится выбором активных людей, а не текстом: имя в строке легко
 * опечатать, а группа с «потерянным» человеком молча не дойдёт до него.
 * Правила названия (длина, уникальность, лимит групп) проверяет сервер, здесь
 * его текст просто показывается — второй копии правил в форме нет.
 */
type Editing = {
  id: number | null;
  name: string;
  memberIds: Set<number>;
  /** Сохранённое имя и состав: по ним видно, что менялось, и что назвать в вопросе об удалении. */
  savedName: string;
  savedMemberIds: number[];
};

export function GroupsScreen({ employees }: { employees: readonly Employee[] }) {
  const [groups, setGroups] = useState<RecipientGroupView[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Уволенных в выборе нет: в рассылку они всё равно не попадают.
  const people = employees.filter((e) => e.isActive);

  async function reload() {
    try {
      setGroups(await apiClient.getRecipientGroups());
      setLoadFailed(false);
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setError(err instanceof Error ? err.message : "Не удалось загрузить группы");
      setLoadFailed(true);
      // Без этого экран остался бы на «Загрузке» вечно: ошибку некому было бы показать.
      setGroups((prev) => prev ?? []);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  /** `true` — действие прошло; при отказе форма остаётся с набранным. */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (err) {
      if (!(err instanceof AuthRequiredError)) setError(err instanceof Error ? err.message : "Не удалось сохранить");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function open(group: RecipientGroupView | null) {
    setError(null);
    setQuery("");
    setEditing(
      group
        ? { id: group.id, name: group.name, memberIds: new Set(group.memberIds), savedName: group.name, savedMemberIds: group.memberIds }
        : { id: null, name: "", memberIds: new Set(), savedName: "", savedMemberIds: [] },
    );
  }

  function toggle(id: number) {
    setEditing((cur) => {
      if (!cur) return cur;
      const next = new Set(cur.memberIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...cur, memberIds: next };
    });
  }

  async function save() {
    if (!editing) return;
    const memberIds = people.filter((p) => editing.memberIds.has(p.id)).map((p) => p.id);
    // Состав шлём, только если он менялся: переименование не должно трогать
    // состав, а у редактора он и так неполный (уволенных в нём нет).
    const membersChanged =
      memberIds.length !== editing.savedMemberIds.length || memberIds.some((id) => !editing.savedMemberIds.includes(id));
    const id = editing.id;
    const ok = await run(() =>
      id === null
        ? apiClient.createRecipientGroup({ name: editing.name, memberIds })
        : apiClient.saveRecipientGroup(id, membersChanged ? { name: editing.name, memberIds } : { name: editing.name }),
    );
    if (ok) setEditing(null);
  }

  if (!groups) return <div className="employees-empty">Загрузка…</div>;

  if (loadFailed) {
    return (
      <div className="employees-screen">
        <div className="employees-header">
          <h2 className="employees-title">Группы</h2>
        </div>
        <div className="employees-error">{error}</div>
        <div>
          <button type="button" className="btn btn-secondary" onClick={() => { setError(null); void reload(); }}>
            Повторить
          </button>
        </div>
      </div>
    );
  }

  const visible = filterPeople(people, query);

  function renderEditor(current: Editing) {
    return (
      <div className="kind-people" data-group-editor>
        <input
          type="text"
          name="group-name"
          aria-label="Название группы"
          placeholder="Название группы"
          maxLength={RECIPIENT_GROUP_NAME_MAX}
          value={current.name}
          disabled={busy}
          onChange={(e) => setEditing({ ...current, name: e.target.value })}
        />
        {error && <div className="employees-error">{error}</div>}
        <span className="field-label">В группе: {current.memberIds.size}</span>
        <PersonSearch value={query} onChange={setQuery} count={people.length} disabled={busy} />
        {people.length === 0 ? (
          <div className="employees-empty">Выбирать некого.</div>
        ) : visible.length === 0 ? (
          <div className="employees-empty">Никого с таким именем нет.</div>
        ) : (
          <div className="category-select">
            {visible.map((p) => {
              const on = current.memberIds.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`category-option${on ? " selected" : ""}`}
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => toggle(p.id)}
                >
                  {p.displayName}
                </button>
              );
            })}
          </div>
        )}
        <div className="field-row" style={{ flexWrap: "wrap", marginTop: 8 }}>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            Сохранить
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setEditing(null)}>
            Отмена
          </button>
          {current.id !== null && (
            <ConfirmButton
              label="Удалить группу"
              question={`Удалить «${current.savedName}»? В уже разосланных сборах список адресатов не изменится. Неразосланные сборы с этой группой не уйдут, пока не выберешь другую.`}
              confirmLabel="Да, удалить"
              disabled={busy}
              onConfirm={() => {
                const id = current.id!;
                void run(() => apiClient.deleteRecipientGroup(id)).then((ok) => { if (ok) setEditing(null); });
              }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="employees-screen employees-screen-form">
      <div className="employees-header">
        <h2 className="employees-title">Группы</h2>
      </div>

      <p className="birthday-intro">
        Список людей, который выбирается одной кнопкой в рассылках. Уволенные из группы выпадают сами и
        возвращаются, если их восстановить.
      </p>

      {error && !editing && <div className="employees-error">{error}</div>}

      {groups.length === 0 && !editing && (
        <div className="empty-state">Групп пока нет — заведите первую, например «ЧИП 5-й этаж».</div>
      )}

      <div className="employees-list">
        {groups.map((g) => (
          <section className="kind-card" key={g.id}>
            <button
              type="button"
              className="kind-card-head"
              disabled={busy}
              aria-expanded={editing?.id === g.id}
              onClick={() => (editing?.id === g.id ? setEditing(null) : open(g))}
            >
              <span className="kind-name" style={{ minWidth: 0, overflowWrap: "anywhere" }}>{g.name}</span>
              <span className="kind-meta" style={{ whiteSpace: "nowrap" }}>{g.memberIds.length} чел.</span>
              <span className="kind-chevron">{editing?.id === g.id ? "▴" : "▾"}</span>
            </button>
            {editing?.id === g.id && renderEditor(editing)}
          </section>
        ))}

        {editing?.id === null && <section className="kind-card">{renderEditor(editing)}</section>}
      </div>

      {!editing && (
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => open(null)}>
            + Новая группа
          </button>
        </div>
      )}
    </div>
  );
}
