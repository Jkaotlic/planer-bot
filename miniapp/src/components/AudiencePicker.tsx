import { useEffect, useMemo, useState } from "react";
import { SegmentedControl } from "@telegram-apps/telegram-ui";
import { filterPeople } from "@planer/shared";
import { apiClient, type AudienceCandidate, type TeamAudience } from "../api/client";
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
 * Наблюдатели в «команду» и «на смене» не входят — как в пресетах анонсов.
 */
export function AudiencePicker({ value, onChange, disabled }: {
  value: TeamAudience;
  onChange(next: TeamAudience): void;
  disabled?: boolean;
}) {
  const [people, setPeople] = useState<AudienceCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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
    if (value.kind === "team") return people.filter((p) => p.role !== "observer");
    if (value.kind === "on_shift") return people.filter((p) => p.onShift && p.role !== "observer");
    return people.filter((p) => picked.has(p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, value]);

  function setMode(mode: Mode) {
    if (mode === "picked") onChange({ kind: "picked", employeeIds: value.kind === "picked" ? value.employeeIds : [] });
    else onChange({ kind: mode });
  }

  function toggle(id: number) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange({ kind: "picked", employeeIds: [...next] });
  }

  if (loadError) return <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13 }}>{loadError}</div>;
  if (!people) return <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>Загружаю команду…</div>;

  const reachable = preview.filter((p) => p.reachable).map((p) => p.displayName);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <SegmentedControl>
        <SegmentedControl.Item selected={value.kind === "on_shift"} onClick={() => !disabled && setMode("on_shift")}>Сегодня на смене</SegmentedControl.Item>
        <SegmentedControl.Item selected={value.kind === "team"} onClick={() => !disabled && setMode("team")}>Вся команда</SegmentedControl.Item>
        <SegmentedControl.Item selected={value.kind === "picked"} onClick={() => !disabled && setMode("picked")}>Выбрать</SegmentedControl.Item>
      </SegmentedControl>
      {value.kind === "picked" && (
        <div>
          <PersonSearch value={query} onChange={setQuery} count={people.length} disabled={disabled} />
          {filterPeople(people, query).map((p) => (
            <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, padding: "4px 0", cursor: "pointer" }}>
              <input type="checkbox" checked={picked.has(p.id)} disabled={disabled} onChange={() => toggle(p.id)} />
              <span>{p.displayName}</span>
              {!p.reachable && <span style={{ color: "var(--tgui--hint_color)", fontSize: 12 }}>— не привязан</span>}
            </label>
          ))}
        </div>
      )}
      <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>
        {reachable.length === 0 ? "Пока никого, кроме тебя." : `Уйдёт: ${reachable.join(", ")} и тебе`}
      </div>
    </div>
  );
}
