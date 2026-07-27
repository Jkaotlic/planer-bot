export interface TopBarProps {
  weekLabel: string;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onDistributeFairly: () => void;
  onAddEntry: () => void;
  /** Opens the safe CSV preview/reconciliation flow. */
  onImportRoster: () => void;
  /** Downloads the current month's roster as CSV (the schedule IS the roster). */
  onExportRoster: () => void;
}

/** Week switcher + primary actions, above the schedule grid. */
export function TopBar({ weekLabel, onPrevWeek, onNextWeek, onDistributeFairly, onAddEntry, onImportRoster, onExportRoster }: TopBarProps) {
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
      <div className="roster-actions">
        <button type="button" className="btn btn-secondary" onClick={onImportRoster}>
          ⬆ Загрузить CSV
        </button>
        <button type="button" className="btn btn-secondary" onClick={onExportRoster}>
          ⬇ Выгрузить CSV
        </button>
      </div>
      <button type="button" className="btn btn-secondary" onClick={onDistributeFairly} disabled>
        ⚖ Распределить честно
      </button>
      <button type="button" className="btn btn-primary" onClick={onAddEntry}>
        ＋ Добавить смену
      </button>
    </div>
  );
}
