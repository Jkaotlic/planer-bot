export interface TopBarProps {
  weekLabel: string;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onAddEntry: () => void;
  /** Opens the safe CSV preview/reconciliation flow. */
  onImportRoster: () => void;
  /** Downloads the current month's roster as CSV (the schedule IS the roster). */
  onExportRoster: () => void;
}

/** Week switcher + primary actions, above the schedule grid.
 *
 *  «Распределить честно» is deliberately absent: the console never had a client
 *  method for it, so the button sat here permanently disabled and read as broken
 *  software. The feature itself works — it lives in the Mini App's «Админ» tab. */
export function TopBar({ weekLabel, onPrevWeek, onNextWeek, onAddEntry, onImportRoster, onExportRoster }: TopBarProps) {
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
      <button type="button" className="btn btn-primary" onClick={onAddEntry}>
        ＋ Добавить смену
      </button>
    </div>
  );
}
