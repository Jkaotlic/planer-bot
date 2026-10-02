import type { ReactNode } from "react";

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

// Значки в стиле бокового меню (линия `currentColor`), но 16px: кнопка шапки
// ниже пункта меню. Эмодзи здесь рисовались шрифтом системы — у каждого
// браузера по-своему и не в цвет кнопки (на `.btn-primary` — цветным пятном).
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function UploadIcon() {
  return <Icon><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></Icon>;
}

function DownloadIcon() {
  return <Icon><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></Icon>;
}

function CalendarIcon() {
  return (
    <Icon>
      <rect x="3" y="4" width="18" height="18" rx="3" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </Icon>
  );
}

function PlusIcon() {
  return <Icon><path d="M12 5v14M5 12h14" /></Icon>;
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
          <UploadIcon />
          Загрузить CSV
        </button>
        <button type="button" className="btn btn-secondary" onClick={onExportRoster}>
          <DownloadIcon />
          Выгрузить CSV
        </button>
      </div>
      {/* Рядом с «Добавить смену», а не в CSV-группе: это тоже постановка
          записей, только на неделю разом. */}
      <div className="topbar-entry-actions">
        <button type="button" className="btn btn-secondary" onClick={onFillWeek}>
          <CalendarIcon />
          Заполнить неделю
        </button>
        <button type="button" className="btn btn-primary" onClick={onAddEntry}>
          <PlusIcon />
          Добавить смену
        </button>
      </div>
    </div>
  );
}
