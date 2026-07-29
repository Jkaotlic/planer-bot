import { Cell } from "@telegram-apps/telegram-ui";
import type { Shift, Template } from "../api/client";
import { formatTimeRange } from "../lib/shift";
import { DayBadge } from "./DayBadge";
import { EntryChip } from "./EntryChip";

export interface ShiftRowProps {
  shift: Shift;
  /** Presets, to colour the entry by the one it came from. */
  templates: readonly Template[];
  /** Opens the "Предложить обмен" flow for this shift. Omit to render the row read-only (no "Обменять" pill). */
  onSwap?: (shift: Shift) => void;
  /** Today's row is marked: an accent rail on the left and a «Сегодня» chip. */
  isToday?: boolean;
}

/** A single row in "Мои смены": day, time (or "Весь день"), and a chip naming the
 * entry in its preset's colour. */
export function ShiftRow({ shift, templates, onSwap, isToday }: ShiftRowProps) {
  const isSwappable = shift.category === "shift";

  return (
    <Cell
      // Styled on the `Cell` itself, not on a wrapper `div`: `Section` reads its
      // own children to decide where dividers go, and an extra element between
      // them changes that. `CellProps` extends `AllHTMLAttributes`, so `style`
      // lands on the row's root element.
      style={
        isToday
          ? {
              // A rail rather than a filled row: the entry chip inside already
              // carries the preset's colour, and two backgrounds fight.
              boxShadow: "inset 3px 0 var(--tgui--link_color)",
              background: "color-mix(in srgb, var(--tgui--link_color) 7%, transparent)",
            }
          : undefined
      }
      before={<DayBadge date={shift.date} endDate={shift.endDate} />}
      // The chip already names the entry ("Утро" / "Отпуск"), so it stands in for
      // the subtitle that used to repeat that same label right above it. Unlike
      // the old category chip it shows on every row, since a work shift's preset
      // is exactly what the colour is here to tell apart.
      description={<EntryChip entry={shift} templates={templates} />}
      after={isSwappable && onSwap ? <SwapChip onClick={() => onSwap(shift)} /> : undefined}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {formatTimeRange(shift)}
        {isToday && <TodayChip />}
      </span>
    </Cell>
  );
}

/** The text half of the "today" signal — colour is never the only carrier. */
function TodayChip() {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.2,
        borderRadius: 999,
        padding: "2px 8px",
        color: "var(--tgui--button_text_color)",
        background: "var(--tgui--link_color)",
      }}
    >
      Сегодня
    </span>
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
