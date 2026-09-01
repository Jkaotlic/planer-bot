export type NavKey = "schedule" | "employees" | "kinds" | "checklist" | "weekend" | "collections" | "announce" | "bugs" | "log" | "settings";

export interface SidebarProps {
  active: NavKey;
  onChange: (key: NavKey) => void;
  /** Short label for the footer, e.g. "Аня · админ". */
  adminLabel: string;
  /**
   * Открыта ли шторка. На десктопе не значит ничего: сайдбар там виден всегда,
   * признак читает только медиазапрос `max-width: 900px`.
   */
  open: boolean;
}

export const NAV_ITEMS: ReadonlyArray<{ key: NavKey; label: string; icon: JSX.Element }> = [
  { key: "schedule", label: "Расписание", icon: <CalendarIcon /> },
  { key: "employees", label: "Работники", icon: <PeopleIcon /> },
  { key: "kinds", label: "Виды смен", icon: <KindsIcon /> },
  { key: "checklist", label: "Чек-лист", icon: <ChecklistIcon /> },
  { key: "weekend", label: "Работа в выходные", icon: <MarketIcon /> },
  { key: "collections", label: "Сборы", icon: <CakeIcon /> },
  { key: "announce", label: "Анонсы", icon: <AnnounceIcon /> },
  { key: "bugs", label: "Баги", icon: <BugIcon /> },
  { key: "log", label: "Журнал", icon: <LogIcon /> },
  { key: "settings", label: "Настройки", icon: <GearIcon /> },
];

/** Подпись экрана для мобильной шапки — та же, что у пункта меню: два разных
 *  названия одного экрана человек читает как два разных места. */
export function navLabel(key: NavKey): string {
  return NAV_ITEMS.find((item) => item.key === key)?.label ?? "Смены";
}

/** Left navigation rail: brand, nav items, and a footer identifying the signed-in admin. */
export function Sidebar({ active, onChange, adminLabel, open }: SidebarProps) {
  return (
    <aside className={`sidebar${open ? " open" : ""}`}>
      <div className="sidebar-brand">Смены</div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`sidebar-nav-item${active === item.key ? " active" : ""}`}
            onClick={() => onChange(item.key)}
          >
            <span className="sidebar-nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">{adminLabel}</div>
    </aside>
  );
}

function ChecklistIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M9 5h10M9 12h10M9 19h10" />
      <path d="M3 5l1.6 1.6L7.5 3.6M3 12l1.6 1.6L7.5 10.6M3 19l1.6 1.6L7.5 17.6" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="3" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5" />
      <path d="M16 6.5a3 3 0 0 1 0 5.5M21 20c0-2.6-1.4-4.2-3.5-4.8" />
    </svg>
  );
}

function MarketIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V10" />
      <path d="M11 10V4.5a1.5 1.5 0 0 1 3 0V10" />
      <path d="M14 10.5V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a5 5 0 0 1-4.3-2.5L4 14a1.6 1.6 0 0 1 2.6-1.8L8 14V8" />
    </svg>
  );
}

function LogIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 5h16M4 12h16M4 19h10" strokeLinecap="round" />
    </svg>
  );
}

/** A cake with one candle — the only nav item that isn't about work. */
function CakeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v3" />
      <path d="M5 11a2.5 2.5 0 0 1 5 0 2.5 2.5 0 0 0 4 0 2.5 2.5 0 0 1 5 0v4H5z" />
      <path d="M3 15h18v5H3z" />
    </svg>
  );
}

/** Рупор — тот же символ, что у наблюдательской вкладки «Анонс» в мини-аппе
 *  (`TabBar.tsx`), но нарисован в узоре 18×18 сайдбара, а не 28×28 таббара. */
function AnnounceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10v4a1 1 0 0 0 1 1h2l4 4V5l-4 4H4a1 1 0 0 0-1 1z" />
      <path d="M15 8a4 4 0 0 1 0 8M18 5a8 8 0 0 1 0 14" />
    </svg>
  );
}

/** Жук — та же метафора, что у кнопки «🐞 Проблема» в боте: человек ищет глазами
 *  то, что нажимал, а не то, как это называется в базе. */
function BugIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="8" y="8" width="8" height="12" rx="4" />
      <path d="M9 8a3 3 0 0 1 6 0M3 12h5M16 12h5M4 7l3 2M20 7l-3 2M4 18l3-2M20 18l-3-2" />
    </svg>
  );
}

/** Sliders — «Виды смен» is where a kind of shift is configured, not scheduled. */
function KindsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

/** Шестерёнка — «Настройки» это общий рычаг для всей команды, а не расписание. */
function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.4M12 18.6V21M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M3 12h2.4M18.6 12H21M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" />
    </svg>
  );
}
