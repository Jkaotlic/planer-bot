import { Cell } from "@telegram-apps/telegram-ui";
import type { Shift } from "../api/client";
import { CategoryChip, categoryLabel } from "../categories";
import { formatTimeRange } from "../lib/shift";
import { DayBadge } from "./DayBadge";

export interface ShiftRowProps {
  shift: Shift;
  /** Opens the "Предложить обмен" flow for this shift. Omit to render the row read-only (no "Обменять" pill). */
  onSwap?: (shift: Shift) => void;
}

/** A single row in "Мои смены": day, time (or "Весь день"), what it is, and its category. */
export function ShiftRow({ shift, onSwap }: ShiftRowProps) {
  const isSwappable = shift.category === "shift";

  return (
    <Cell
      before={<DayBadge date={shift.date} endDate={shift.endDate} />}
      subtitle={shift.title ?? categoryLabel(shift.category)}
      description={!isSwappable ? <CategoryChip category={shift.category} /> : undefined}
      after={isSwappable && onSwap ? <SwapChip onClick={() => onSwap(shift)} /> : undefined}
    >
      {formatTimeRange(shift)}
    </Cell>
  );
}

interface SwapChipProps {
  onClick: () => void;
}

/** The "Обменять" affordance: opens the propose-swap flow for this shift. */
function SwapChip({ onClick }: SwapChipProps) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        // `position: relative` is load-bearing, not cosmetic: `Cell`'s tap
        // ripple is an absolutely-positioned overlay with `z-index: auto`,
        // which paints *above* ordinary static-positioned content per CSS
        // stacking rules — without this, the ripple silently swallows every
        // click/tap on this chip (confirmed both in a real Chromium render
        // and via Playwright's "element intercepts pointer events" check).
        // telegram-ui's own interactive controls (e.g. `Selectable`) rely on
        // this same trick internally, which is how they get away with it.
        position: "relative",
        display: "inline-block",
        fontSize: 13,
        fontWeight: 600,
        color: "var(--tgui--link_color)",
        boxShadow: "0 0 0 1.4px color-mix(in srgb, var(--tgui--link_color) 40%, transparent)",
        borderRadius: 999,
        padding: "6px 12px",
        whiteSpace: "nowrap",
        cursor: "pointer",
      }}
    >
      Обменять
    </span>
  );
}
