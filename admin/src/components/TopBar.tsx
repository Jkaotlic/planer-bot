export interface TopBarProps {
  weekLabel: string;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onDistributeFairly: () => void;
  onAddEntry: () => void;
}

/** Week switcher + primary actions, above the schedule grid. */
export function TopBar({ weekLabel, onPrevWeek, onNextWeek, onDistributeFairly, onAddEntry }: TopBarProps) {
  return (
    <div className="topbar">
      <div className="week-switcher">
        <button type="button" className="week-switcher-btn" onClick={onPrevWeek} aria-label="Предыдущая неделя">
          ‹
        </button>
        <span className="week-label">{weekLabel}</span>
        <button type="button" className="week-switcher-btn" onClick={onNextWeek} aria-label="Следующая неделя">
          ›
        </button>
      </div>
      <div className="topbar-spacer" />
      <button type="button" className="btn btn-secondary" onClick={onDistributeFairly} disabled>
        ⚖ Распределить честно
      </button>
      <button type="button" className="btn btn-primary" onClick={onAddEntry}>
        ＋ Добавить смену
      </button>
    </div>
  );
}
