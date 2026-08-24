import type { CSSProperties, ReactNode } from "react";

/**
 * Bottom clearance every tab screen needs to fully scroll clear of the fixed
 * `Tabbar` (see `TabBar.tsx`) — its own rendered height plus the device's
 * bottom safe-area inset, with a generous safety margin on top since the
 * Tabbar renders a few px taller on some platform variants (e.g. iOS) than
 * the desktop-mocked dev environment does. Exported so any one-off layout
 * that isn't using `ScreenScroll` (e.g. a screen with its own fixed footer
 * button) can still reuse the same number.
 *
 * Инсет берётся из `--app-inset-bottom` (`index.css`), а не из голого `env()`:
 * в полноэкранном режиме webview занимает весь экран, `env()` возвращает ноль,
 * и последняя строка списка пряталась бы за полоской-индикатором.
 */
export const TAB_BAR_CLEARANCE = "calc(96px + var(--app-inset-bottom, env(safe-area-inset-bottom)))";

export interface ScreenScrollProps {
  children: ReactNode;
  style?: CSSProperties;
}

/**
 * Shared root for every screen shown alongside the bottom `TabBar`. Reserves
 * `TAB_BAR_CLEARANCE` below the content so the last row never renders under
 * the fixed tab bar, regardless of how tall it happens to render — fixes
 * that bug once here instead of duplicating a padding number per screen.
 */
export function ScreenScroll({ children, style }: ScreenScrollProps) {
  return <div style={{ padding: `16px 16px ${TAB_BAR_CLEARANCE}`, ...style }}>{children}</div>;
}
