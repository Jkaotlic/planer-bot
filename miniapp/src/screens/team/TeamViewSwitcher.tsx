import {
  useEffect,
  useRef,
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

interface TeamViewKeyEvent {
  key: string;
  preventDefault(): void;
}

type TeamModeChange = (mode: TeamMode) => boolean | void;

export function handleTeamViewSwitcherKeyDown(
  event: TeamViewKeyEvent,
  mode: TeamMode,
  onChange: TeamModeChange,
  focus: (mode: TeamMode) => void,
): boolean {
  const next = teamModeForArrowKey(mode, event.key);
  if (!next) return false;
  event.preventDefault();
  const accepted = onChange(next);
  if (accepted !== false) focus(next);
  return true;
}

export function TeamViewSwitcher({
  value,
  focusValue = value,
  onChange,
}: {
  value: TeamMode;
  focusValue?: TeamMode;
  onChange: TeamModeChange;
}) {
  const tabs = useRef<Partial<Record<TeamMode, HTMLButtonElement>>>({});
  const previousFocusValue = useRef(focusValue);

  useEffect(() => {
    if (previousFocusValue.current === focusValue) return;
    previousFocusValue.current = focusValue;
    tabs.current[focusValue]?.focus();
  }, [focusValue]);

  function focus(mode: TeamMode) {
    tabs.current[mode]?.focus();
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
          tabIndex={focusValue === mode ? 0 : -1}
          className={value === mode ? "team-switcher__button is-active" : "team-switcher__button"}
          onClick={() => onChange(mode)}
          onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
            handleTeamViewSwitcherKeyDown(event, mode, onChange, focus);
          }}
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
