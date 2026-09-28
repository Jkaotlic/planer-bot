export interface TopBarProps {
  weekLabel: string;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onAddEntry: () => void;
  /** Opens «Заполнить неделю» — per-day choices for one worker, one request. */
  onFillWeek: () => void;
  /** Opens the safe CSV preview/reconciliation flow. */
  onImportRoster: () => void;
  /** Downloads the current month's roster as CSV (the schedule IS the roster). */
  onExportRoster: () => void;
}

/** Week switcher + primary actions, above the schedule grid. */
export function TopBar({ weekLabel, onPrevWeek, onNextWeek, onAddEntry, onFillWeek, onImportRoster, onExportRoster }: TopBarProps) {
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
      {/* Рядом с «Добавить смену», а не в CSV-группе: это тоже постановка
          записей, только на неделю разом. */}
      <div className="topbar-entry-actions">
        <button type="button" className="btn btn-secondary" onClick={onFillWeek}>
          📅 Заполнить неделю
        </button>
        <button type="button" className="btn btn-primary" onClick={onAddEntry}>
          ＋ Добавить смену
        </button>
      </div>
    </div>
  );
}
