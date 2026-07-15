import type { ReactNode } from "react";

/**
 * The rounded-card primitives the admin sub-screens share, extracted so they
 * read identically to `WeekendScreen`'s worker-facing cards (which keep their
 * own private copies). `CardStack` lays cards out in a single padded column;
 * `CardShell` is one card; `MetaLine` is a muted "📍 …"/"💬 …" detail row.
 */

/** Vertically stacked cards with breathing room. */
export function CardStack({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 12px" }}>{children}</div>;
}

export function CardShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--tgui--section_bg_color, var(--tgui--bg_color))",
        borderRadius: 14,
        padding: "14px 14px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {children}
    </div>
  );
}

/** A muted icon + text detail line ("📍 ТЦ Авиапарк", "💬 …"). */
export function MetaLine({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 6, fontSize: 13.5, color: "var(--tgui--hint_color)", lineHeight: 1.35 }}>
      <span style={{ flex: "none" }}>{icon}</span>
      <span>{children}</span>
    </div>
  );
}
