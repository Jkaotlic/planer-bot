import { useEffect, useMemo, useState } from "react";
import { Button } from "@telegram-apps/telegram-ui";
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
  // Отдельной строкой, а не молча: запускающий иначе узнаёт про недошедших
  // только из отчёта после отправки — а решить «позвать по-другому» до
  // отправки может только здесь.
  const unreachable = preview.filter((p) => !p.reachable).map((p) => p.displayName);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Ряд кнопок, а не `SegmentedControl`: тот делит ширину на три равные
          части и режет «На смене» троеточием уже на 360px (замер 2026-09-29,
          110 > 108) — тот же изъян, что увёл подборки анонса в свой ряд
          (`AdminAnnounce.tsx:186-187`). Кнопка по содержимому не режется. */}
      <div style={{ display: "flex", gap: 6 }}>
        <Button size="s" mode={value.kind === "on_shift" ? "filled" : "bezeled"} disabled={disabled} onClick={() => setMode("on_shift")}>На смене</Button>
        <Button size="s" mode={value.kind === "team" ? "filled" : "bezeled"} disabled={disabled} onClick={() => setMode("team")}>Все</Button>
        <Button size="s" mode={value.kind === "picked" ? "filled" : "bezeled"} disabled={disabled} onClick={() => setMode("picked")}>Выбрать</Button>
      </div>
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
      {unreachable.length > 0 && (
        <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 12.5 }}>
          Не дойдёт: {unreachable.join(", ")} — не привязан(а) к боту
        </div>
      )}
    </div>
  );
}
