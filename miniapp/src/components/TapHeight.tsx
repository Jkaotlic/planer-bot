import type { ReactNode } from "react";

/**
 * Обёртка для `SegmentedControl` из telegram-ui: сам он тянется на 100% высоты
 * родителя, а своей не имеет и выходит ниже 44px. Фиксированная `height`, а не
 * `min-height`: процент у потомка считается только от заданной высоты.
 */
export function TapHeight({ children }: { children: ReactNode }) {
  return <div style={{ height: "var(--app-tap)" }}>{children}</div>;
}
