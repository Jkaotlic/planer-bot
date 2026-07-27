import type { TeamMode } from "../../lib/team-schedule";

export function TeamViewSwitcher({
  value,
  onChange,
}: {
  value: TeamMode;
  onChange: (value: TeamMode) => void;
}) {
  return (
    <div className="team-switcher" role="tablist" aria-label="Вид расписания">
      {(["today", "week"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          role="tab"
          aria-selected={value === mode}
          className={value === mode ? "team-switcher__button is-active" : "team-switcher__button"}
          onClick={() => onChange(mode)}
        >
          {mode === "today" ? "Сегодня" : "Неделя"}
        </button>
      ))}
    </div>
  );
}
