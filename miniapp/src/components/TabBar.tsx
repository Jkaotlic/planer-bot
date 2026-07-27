import { Tabbar } from "@telegram-apps/telegram-ui";

export type TabKey = "mine" | "team" | "swaps" | "weekend" | "admin";

export interface TabBarProps {
  active: TabKey;
  onChange: (tab: TabKey) => void;
  /** When true, an extra "Админ" tab is shown; hidden entirely for regular workers. */
  isAdmin: boolean;
}

/** Bottom navigation: "Смены", "Команда", "Обмены", "Выходные" (работа в выходные дни), and — for admins only — "Админ". */
export function TabBar({ active, onChange, isAdmin }: TabBarProps) {
  // Built as an array (rather than inline JSX with a `&&`) so the optional
  // admin item stays a bare element — `Tabbar` types its children as a plain
  // element array and rejects the `false` a short-circuit would leave behind.
  const items = [
    <Tabbar.Item key="mine" selected={active === "mine"} text="Смены" onClick={() => onChange("mine")}>
      <CalendarIcon />
    </Tabbar.Item>,
    <Tabbar.Item key="team" selected={active === "team"} text="Команда" onClick={() => onChange("team")}>
      <PeopleIcon />
    </Tabbar.Item>,
    <Tabbar.Item key="swaps" selected={active === "swaps"} text="Обмены" onClick={() => onChange("swaps")}>
      <SwapIcon />
    </Tabbar.Item>,
    <Tabbar.Item key="weekend" selected={active === "weekend"} text="Выходные" onClick={() => onChange("weekend")}>
      <MarketIcon />
    </Tabbar.Item>,
  ];
  if (isAdmin) {
    items.push(
      <Tabbar.Item key="admin" selected={active === "admin"} text="Админ" onClick={() => onChange("admin")}>
        <ShieldIcon />
      </Tabbar.Item>,
    );
  }
  // Wrapped so `index.css` can reach the items: five tabs on a phone leave
  // telegram-ui's default padding no room for the labels, and every one of them
  // rendered as «Сме…». The class is the only stable hook — telegram-ui's own
  // class names are content hashes.
  return (
    <div className="tab-bar-fit">
      <Tabbar>{items}</Tabbar>
    </div>
  );
}

// Paths reused verbatim from the approved product mockup's tab bar icons.
function CalendarIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="3" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5" />
      <path d="M16 6.5a3 3 0 0 1 0 5.5M21 20c0-2.6-1.4-4.2-3.5-4.8" />
    </svg>
  );
}

/** Two opposing curved arrows — the "Обмены" (swap requests) tab icon. */
function SwapIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 8h13l-3-3M20 16H7l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A raised hand — the "Выходные" (работа в выходные дни) tab icon, echoing the "🙋 Хочу" action. */
function MarketIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V10" />
      <path d="M11 10V4.5a1.5 1.5 0 0 1 3 0V10" />
      <path d="M14 10.5V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a5 5 0 0 1-4.3-2.5L4 14a1.6 1.6 0 0 1 2.6-1.8L8 14V8" />
    </svg>
  );
}

/** A shield with a check — the admin-only "Админ" tab icon. */
function ShieldIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v5c0 4.4-3 8-7 10-4-2-7-5.6-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
