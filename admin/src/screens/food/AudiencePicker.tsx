import { useEffect, useState } from "react";
import { audienceLines, audiencePreview, filterPeople, type AudienceCandidate, type TeamAudience } from "@planer/shared";
import { apiClient, type RecipientGroupView } from "../../api/client";
import { PersonSearch } from "../../components/PersonSearch";
import { Segmented } from "../../components/Segmented";
import { useAuthRequired } from "../../auth-required";
import { failureText } from "./food-errors";

const MODES = [
  { key: "on_shift", label: "На смене" },
  { key: "team", label: "Все" },
  { key: "picked", label: "Выбрать" },
] as const;

/**
 * Кому уйдёт опрос или заказ: сегодня на смене / вся команда / вручную.
 *
 * Поведение — как у `miniapp/src/components/AudiencePicker.tsx`, слова — из
 * `audienceLines`: строка «Наблюдателям — копия всегда» называет тех, кому сервер
 * шлёт копию любого опроса и заказа (решение 2026-10-06), иначе запускающий думал
 * бы, что их не позвали. Не общий компонент с «Анонсами»: там два режима и
 * подборки по ролям, здесь три режима и «на смене».
 */
export function AudiencePicker({ value, onChange, disabled }: {
  value: TeamAudience;
  onChange(next: TeamAudience): void;
  disabled?: boolean;
}) {
  const onAuthRequired = useAuthRequired();
  const [people, setPeople] = useState<AudienceCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<RecipientGroupView[]>([]);
  /** Какая группа горит. Сбрасывается любой другой правкой: список уже не «вся группа». */
  const [groupId, setGroupId] = useState<number | null>(null);

  // Группы — удобство: без них человек всё равно отметит всех руками.
  useEffect(() => {
    let cancelled = false;
    apiClient.getRecipientGroups()
      .then((list) => { if (!cancelled) setGroups(list); })
      .catch(() => { /* нет ряда групп — и всё */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiClient.getTeamAudience()
      .then((list) => { if (!cancelled) setPeople(list); })
      .catch((err) => { if (!cancelled) setLoadError(failureText(err, "Не удалось загрузить команду", onAuthRequired)); });
    return () => { cancelled = true; };
  }, []);

  if (loadError) return <div className="employees-error" role="alert">{loadError}</div>;
  if (!people) return <div className="employees-empty">Загружаю команду…</div>;

  const picked = new Set(value.kind === "picked" ? value.employeeIds : []);
  const lines = audienceLines(audiencePreview(people, value));

  function setMode(mode: TeamAudience["kind"]) {
    setGroupId(null);
    if (mode === "picked") onChange({ kind: "picked", employeeIds: value.kind === "picked" ? value.employeeIds : [] });
    else onChange({ kind: mode });
  }

  /** Состав группы — только те, кто есть в этом выборе: чужой id в `employeeIds` не нужен. */
  function pickGroup(g: RecipientGroupView) {
    const known = new Set((people ?? []).map((p) => p.id));
    setGroupId(g.id);
    onChange({ kind: "picked", employeeIds: g.memberIds.filter((id) => known.has(id)) });
  }

  function toggle(id: number) {
    setGroupId(null);
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ kind: "picked", employeeIds: [...next] });
  }

  return (
    <div className="food-form">
      <div className="segmented-row">
        <Segmented aria-label="Кому отправить" options={MODES} value={value.kind} disabled={disabled} onChange={setMode} />
      </div>
      {groups.length > 0 && (
        <div className="food-buttons" data-testid="group-row">
          {groups.map((g) => {
            const on = value.kind === "picked" && groupId === g.id;
            return (
              <button key={g.id} type="button" className="btn btn-secondary announce-group-chip food-chip"
                aria-pressed={on} disabled={disabled} onClick={() => pickGroup(g)}>
                {g.name}
              </button>
            );
          })}
        </div>
      )}
      {value.kind === "picked" && (
        <div className="announce-picker">
          <PersonSearch value={query} onChange={setQuery} count={people.length} disabled={disabled} />
          {filterPeople(people, query).map((p) => (
            <label key={p.id} className="announce-picker-row">
              <input type="checkbox" checked={picked.has(p.id)} disabled={disabled} onChange={() => toggle(p.id)} />
              <span>{p.displayName}</span>
              {!p.reachable && <span className="announce-unreachable">— не привязан</span>}
            </label>
          ))}
        </div>
      )}
      <div className="food-meta">{lines.goes}</div>
      {lines.observers && <div className="food-meta">{lines.observers}</div>}
      {/* До отправки, а не только в отчёте после: решить «позвать по-другому» можно только здесь. */}
      {lines.unreachable && <div className="food-unreachable">{lines.unreachable}</div>}
    </div>
  );
}
