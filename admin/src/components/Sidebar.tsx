export type NavKey = "schedule" | "employees" | "weekend" | "log";

export interface SidebarProps {
  active: NavKey;
  onChange: (key: NavKey) => void;
  /** Short label for the footer, e.g. "Аня · админ". */
  adminLabel: string;
}

const NAV_ITEMS: ReadonlyArray<{ key: NavKey; label: string; icon: JSX.Element }> = [
  { key: "schedule", label: "Расписание", icon: <CalendarIcon /> },
  { key: "employees", label: "Работники", icon: <PeopleIcon /> },
  { key: "weekend", label: "Биржа", icon: <MarketIcon /> },
  { key: "log", label: "Журнал", icon: <LogIcon /> },
];

/** Left navigation rail: brand, nav items, and a footer identifying the signed-in admin. */
export function Sidebar({ active, onChange, adminLabel }: SidebarProps) {
  return (
    <aside className="sidebar">
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
