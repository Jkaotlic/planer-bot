import type { ReactNode } from "react";

/** Приглушённая строка с значком: «📍 ТЦ Авиапарк», «💬 …». */
export function MetaLine({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 6, fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)", lineHeight: 1.35 }}>
      <span style={{ flex: "none" }}>{icon}</span>
      <span>{children}</span>
    </div>
  );
}
