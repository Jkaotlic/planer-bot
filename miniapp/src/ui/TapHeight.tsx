import type { ReactNode } from "react";

/**
 * Обёртка для `SegmentedControl` из telegram-ui: сам он тянется на 100% высоты
 * родителя, а своей не имеет и выходит ниже 44px. Высота задана классом в
 * `ui.css` (там же объяснено, почему не `min-height`).
 */
export function TapHeight({ children }: { children: ReactNode }) {
  return <div className="ui-tap-height">{children}</div>;
}
