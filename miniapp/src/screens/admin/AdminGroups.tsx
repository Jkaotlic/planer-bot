import { useEffect, useState } from "react";
import { Button, Input, Placeholder, Section, Spinner } from "@telegram-apps/telegram-ui";
import { filterPeople, RECIPIENT_GROUP_NAME_MAX } from "@planer/shared";
import { apiClient, type Employee, type RecipientGroupView } from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";
import { ConfirmButton } from "../../components/ConfirmButton";
import { PersonSearch } from "../../components/PersonSearch";
import { ScreenScroll } from "../../components/ScreenScroll";

/**
 * «Группы» — списки людей, которые админ правит сам и потом выбирает одной
 * кнопкой в рассылках («ЧИП 5-й этаж»).
 *
 * Состав правится галочками по активным людям, а не текстом: имя в строке
 * легко опечатать, а группа с «потерянным» человеком молча не дойдёт до него.
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

export function AdminGroups() {
  const [groups, setGroups] = useState<RecipientGroupView[] | null>(null);
  const [people, setPeople] = useState<Employee[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  async function reload() {
    try {
      const [list, team] = await Promise.all([apiClient.getRecipientGroups(), apiClient.getAdminEmployees()]);
      setGroups(list);
      setPeople(team.filter((e) => e.isActive));
      setLoadFailed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить группы");
      setLoadFailed(true);
      // Без этого экран остался бы на спиннере вечно: ошибку некому было бы показать.
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
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
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

  if (!groups) {
    return (
      <ScreenScroll>
        <Section header="Группы">
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
            <Spinner size="m" />
          </div>
        </Section>
      </ScreenScroll>
    );
  }

  if (loadFailed) {
    return (
      <ScreenScroll>
        <Section header="Группы">
          <CardStack>
            <CardShell>
              <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div>
            </CardShell>
            <Button mode="bezeled" size="m" stretched onClick={() => { setError(null); void reload(); }}>
              Повторить
            </Button>
          </CardStack>
        </Section>
      </ScreenScroll>
    );
  }

  const visible = filterPeople(people, query);

  return (
    <ScreenScroll>
      <Section
        header="Группы"
        footer="Список людей, который выбирается одной кнопкой в рассылках. Уволенные из группы выпадают сами и возвращаются, если их восстановить."
      >
        <CardStack>
          {error && !editing && (
            <CardShell>
              <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div>
            </CardShell>
          )}

          {groups.length === 0 && !editing && (
            <Placeholder description="Групп пока нет — заведи первую, например «ЧИП 5-й этаж»." />
          )}

          {groups.map((g) => (
            <CardShell key={g.id}>
              <button
                type="button"
                onClick={() => (editing?.id === g.id ? setEditing(null) : open(g))}
                disabled={busy}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, width: "100%",
                  background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer",
                }}
              >
                <span style={{ fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>{g.name}</span>
                <span style={{ color: "var(--tgui--hint_color)", fontSize: 13, whiteSpace: "nowrap" }}>{g.memberIds.length} чел.</span>
              </button>
              {editing?.id === g.id && renderEditor()}
            </CardShell>
          ))}

          {editing?.id === null && <CardShell>{renderEditor()}</CardShell>}

          {!editing && (
            <Button mode="bezeled" size="m" stretched disabled={busy} onClick={() => open(null)}>
              + Новая группа
            </Button>
          )}
        </CardStack>
      </Section>
    </ScreenScroll>
  );

  function renderEditor() {
    if (!editing) return null;
    return (
      <div data-group-editor style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
        <Input
          name="group-name"
          aria-label="Название группы"
          placeholder="Название группы"
          maxLength={RECIPIENT_GROUP_NAME_MAX}
          value={editing.name}
          disabled={busy}
          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
        />
        {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div>}
        <div style={{ color: "var(--tgui--hint_color)", fontSize: 12.5, fontWeight: 600 }}>
          В группе: {editing.memberIds.size}
        </div>
        <PersonSearch value={query} onChange={setQuery} count={people.length} disabled={busy} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {people.length === 0 ? (
            <div style={{ color: "var(--tgui--hint_color)", fontSize: 13.5 }}>Выбирать некого.</div>
          ) : visible.length === 0 ? (
            <div style={{ color: "var(--tgui--hint_color)", fontSize: 13.5 }}>Никого с таким именем нет.</div>
          ) : (
            visible.map((p) => (
              <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, padding: "4px 0", cursor: "pointer" }}>
                <input type="checkbox" checked={editing.memberIds.has(p.id)} disabled={busy} onChange={() => toggle(p.id)} />
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{p.displayName}</span>
              </label>
            ))
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button size="s" mode="filled" disabled={busy} loading={busy} onClick={() => void save()}>
            Сохранить
          </Button>
          <Button size="s" mode="plain" disabled={busy} onClick={() => setEditing(null)}>
            Отмена
          </Button>
        </div>
        {editing.id !== null && (
          <ConfirmButton
            label="Удалить группу"
            question={`Удалить «${editing.savedName}»? В уже разосланных сборах список адресатов не изменится. Неразосланные сборы с этой группой не уйдут, пока не выберешь другую.`}
            confirmLabel="Да, удалить"
            mode="plain"
            disabled={busy}
            onConfirm={() => {
              const id = editing.id!;
              void run(() => apiClient.deleteRecipientGroup(id)).then((ok) => { if (ok) setEditing(null); });
            }}
          />
        )}
      </div>
    );
  }
}
