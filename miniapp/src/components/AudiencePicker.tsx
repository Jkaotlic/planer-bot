import { useEffect, useMemo, useState } from "react";
import { filterPeople } from "@planer/shared";
import { apiClient, type AudienceCandidate, type RecipientGroupView, type TeamAudience } from "../api/client";
import { ActionButton } from "../ui";
import { PersonSearch } from "./PersonSearch";

type Mode = TeamAudience["kind"];

/**
 * Кому уйдёт опрос или заказ: вся команда / сегодня на смене / вручную.
 *
 * Отдельный компонент, а не копия выбора из анонсов: там два режима и пресеты
 * по ролям, здесь три режима и «на смене» — общего кода меньше, чем разного.
 * Анонсы не трогаем: они в проде и работают.
 *
 * Строка «Уйдёт: …» показывает поимённо, кого бот позовёт, — в режиме «на
 * смене» человек иначе не узнает, кого график посчитал работающим.
 * Наблюдатели входят в «Все» и «На смене» наравне со всеми (решение 2026-09-30).
 */
export function AudiencePicker({ value, onChange, disabled }: {
  value: TeamAudience;
  onChange(next: TeamAudience): void;
  disabled?: boolean;
}) {
  const [people, setPeople] = useState<AudienceCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<RecipientGroupView[]>([]);
  /** Какая группа горит. Сбрасывается любой другой правкой: список уже не «вся группа». */
  const [groupId, setGroupId] = useState<number | null>(null);

  // Сбой загрузки групп не ломает выбор: группы — удобство, а не необходимость,
  // и человек всё равно может отметить всех руками.
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
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : "Не удалось загрузить команду"); });
    return () => { cancelled = true; };
  }, []);

  const picked = value.kind === "picked" ? new Set(value.employeeIds) : new Set<number>();
  const preview = useMemo(() => {
    if (!people) return [];
    if (value.kind === "team") return people;
    if (value.kind === "on_shift") return people.filter((p) => p.onShift);
    return people.filter((p) => value.kind === "picked" && value.employeeIds.includes(p.id));
  }, [people, value]);

  function setMode(mode: Mode) {
    setGroupId(null);
    if (mode === "picked") onChange({ kind: "picked", employeeIds: value.kind === "picked" ? value.employeeIds : [] });
    else onChange({ kind: mode });
  }

  /** Состав группы — только те, кто загружен в этом выборе: чужой id в
   *  `employeeIds` не нужен, а зрителя, которого нет в списке, не отмечаем. */
  function pickGroup(g: RecipientGroupView) {
    const known = new Set(people?.map((p) => p.id));
    setGroupId(g.id);
    onChange({ kind: "picked", employeeIds: g.memberIds.filter((id) => known.has(id)) });
  }

  function toggle(id: number) {
    setGroupId(null);
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange({ kind: "picked", employeeIds: [...next] });
  }

  if (loadError) return <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>{loadError}</div>;
  if (!people) return <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>Загружаю команду…</div>;

  const reachable = preview.filter((p) => p.reachable).map((p) => p.displayName);
  // Отдельной строкой, а не молча: запускающий иначе узнаёт про недошедших
  // только из отчёта после отправки — а решить «позвать по-другому» до
  // отправки может только здесь.
  const unreachable = preview.filter((p) => !p.reachable).map((p) => p.displayName);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Ряд кнопок, а не `SegmentedControl`: тот делит ширину на три равные
          части и режет «На смене» троеточием уже на 360px (замер 2026-09-29,
          110 > 108) — тот же изъян, что увёл подборки анонса в свой ряд
          (`AdminAnnounce.tsx:186-187`). Кнопка по содержимому не режется; выбранная — с
          `aria-pressed`: тон на тёмной теме едва заметен, и состояние дублирует рамка. */}
      <div style={{ display: "flex", gap: 6 }}>
        <ActionButton compact kind={value.kind === "on_shift" ? "secondary" : "quiet"} aria-pressed={value.kind === "on_shift"} disabled={disabled} onClick={() => setMode("on_shift")}>На смене</ActionButton>
        <ActionButton compact kind={value.kind === "team" ? "secondary" : "quiet"} aria-pressed={value.kind === "team"} disabled={disabled} onClick={() => setMode("team")}>Все</ActionButton>
        <ActionButton compact kind={value.kind === "picked" ? "secondary" : "quiet"} aria-pressed={value.kind === "picked"} disabled={disabled} onClick={() => setMode("picked")}>Выбрать</ActionButton>
      </div>
      {groups.length > 0 && (
        <div data-testid="group-row" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {groups.map((g) => (
            <ActionButton key={g.id} compact kind={value.kind === "picked" && groupId === g.id ? "secondary" : "quiet"} aria-pressed={value.kind === "picked" && groupId === g.id} disabled={disabled} onClick={() => pickGroup(g)}>{g.name}</ActionButton>
          ))}
        </div>
      )}
      {value.kind === "picked" && (
        <div>
          <PersonSearch value={query} onChange={setQuery} count={people.length} disabled={disabled} />
          {filterPeople(people, query).map((p) => (
            <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--app-text-meta)", padding: "4px 0", cursor: "pointer" }}>
              <input type="checkbox" checked={picked.has(p.id)} disabled={disabled} onChange={() => toggle(p.id)} />
              <span>{p.displayName}</span>
              {!p.reachable && <span style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>— не привязан</span>}
            </label>
          ))}
        </div>
      )}
      <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>
        {reachable.length === 0 ? "Пока никого, кроме тебя." : `Уйдёт: ${reachable.join(", ")} и тебе`}
      </div>
      {unreachable.length > 0 && (
        <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>
          Не дойдёт: {unreachable.join(", ")} — не привязан(а) к боту
        </div>
      )}
    </div>
  );
}
