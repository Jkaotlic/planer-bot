import { Tabbar } from "@telegram-apps/telegram-ui";

export type TabKey = "mine" | "team" | "swaps";

export interface TabBarProps {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}

/** Bottom navigation: "Смены" (my shifts), "Команда", and "Обмены" (swap requests). */
export function TabBar({ active, onChange }: TabBarProps) {
  return (
    <Tabbar>
      <Tabbar.Item selected={active === "mine"} text="Смены" onClick={() => onChange("mine")}>
        <CalendarIcon />
      </Tabbar.Item>
      <Tabbar.Item selected={active === "team"} text="Команда" onClick={() => onChange("team")}>
        <PeopleIcon />
      </Tabbar.Item>
      <Tabbar.Item selected={active === "swaps"} text="Обмены" onClick={() => onChange("swaps")}>
        <SwapIcon />
      </Tabbar.Item>
    </Tabbar>
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
