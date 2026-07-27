import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { TeamMode } from "../../lib/team-schedule";

const TEAM_MODES: readonly TeamMode[] = ["today", "week"];

export function teamViewTabId(mode: TeamMode): string {
  return `team-view-tab-${mode}`;
}

export function teamViewPanelId(mode: TeamMode): string {
  return `team-view-panel-${mode}`;
}

export function teamModeForArrowKey(
  mode: TeamMode,
  key: string,
): TeamMode | null {
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  return mode === "today" ? "week" : "today";
}

export function TeamViewSwitcher({
  value,
  onChange,
}: {
  value: TeamMode;
  onChange: (value: TeamMode) => void;
}) {
  const [focusedMode, setFocusedMode] = useState<TeamMode>(value);
  const tabs = useRef<Partial<Record<TeamMode, HTMLButtonElement>>>({});

  useEffect(() => {
    setFocusedMode(value);
  }, [value]);

  function select(mode: TeamMode) {
    setFocusedMode(mode);
    onChange(mode);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, mode: TeamMode) {
    const next = teamModeForArrowKey(mode, event.key);
    if (!next) return;
    event.preventDefault();
    setFocusedMode(next);
    tabs.current[next]?.focus();
    onChange(next);
  }

  return (
    <div className="team-switcher" role="tablist" aria-label="Вид расписания">
      {TEAM_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="tab"
          id={teamViewTabId(mode)}
          aria-selected={value === mode}
          aria-controls={teamViewPanelId(mode)}
          tabIndex={focusedMode === mode ? 0 : -1}
          className={value === mode ? "team-switcher__button is-active" : "team-switcher__button"}
          onClick={() => select(mode)}
          onKeyDown={(event) => onKeyDown(event, mode)}
          ref={(element) => {
            if (element) tabs.current[mode] = element;
            else delete tabs.current[mode];
          }}
        >
          {mode === "today" ? "Сегодня" : "Неделя"}
        </button>
      ))}
    </div>
  );
}

export function TeamViewPanel({
  mode,
  children,
}: {
  mode: TeamMode;
  children?: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={teamViewPanelId(mode)}
      aria-labelledby={teamViewTabId(mode)}
    >
      {children}
    </div>
  );
}
