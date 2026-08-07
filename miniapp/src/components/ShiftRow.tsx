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
  /** Почему обмен сейчас недоступен. Кнопка остаётся на месте, но гаснет и несёт
   *  эту фразу: пропавшая кнопка читается как поломка, погашенная — как правило. */
  swapBlockedReason?: string;
}

/** A single row in "Мои смены": day, time (or "Весь день"), and a chip naming the
 * entry in its preset's colour. */
export function ShiftRow({ shift, templates, onSwap, isToday, swapBlockedReason }: ShiftRowProps) {
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
      // «Сегодня» стоит здесь, а не рядом со временем, потому что рядом со
      // временем для него нет места. `Cell` режет заголовок
      // (`overflow: hidden; text-overflow: ellipsis`), а средней колонке достаётся
      // то, что осталось от бейджа дня и «Обменять»: на Android telegram-ui даёт
      // «base»-метрики (gap 24, padding 24), и это 58px из 240 при ширине экрана
      // 320 и 98px при 360 — при нужных 127. Чип рисовался за границей отсечения и
      // просто не появлялся. Правая колонка растягивается по содержимому, а её
      // ширину и так задаёт «Обменять» (90px), поэтому этот столбик ничего у
      // строки не отнимает — ни на одной ширине.
      after={
        isToday || (isSwappable && onSwap) ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            {isToday && <TodayChip />}
            {isSwappable && onSwap && <SwapChip onClick={() => onSwap(shift)} blockedReason={swapBlockedReason} />}
          </div>
        ) : undefined
      }
    >
      {formatTimeRange(shift)}
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
        whiteSpace: "nowrap",
      }}
    >
      Сегодня
    </span>
  );
}

interface SwapChipProps {
  onClick: () => void;
  /** Причина, по которой обмен сейчас недоступен. Заданная — кнопка гаснет,
   *  показывает эту фразу под собой и не зовёт `onClick`. */
  blockedReason?: string;
}

/** The "Обменять" affordance: opens the propose-swap flow for this shift, or —
 *  with `blockedReason` set — stays on the row dimmed and names why, instead of
 *  disappearing (a missing button reads as "the app is broken"). A real
 *  `<button>`, not a `role="button"` span: its native `disabled` state is what
 *  makes "не срабатывает" free — no extra guard can silently drift out of sync
 *  with the dimmed styling next to it. */
function SwapChip({ onClick, blockedReason }: SwapChipProps) {
  const blocked = blockedReason != null;
  const tint = blocked ? "var(--tgui--hint_color)" : "var(--tgui--link_color)";
  const button = (
    <button
      type="button"
      disabled={blocked}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
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
        fontFamily: "inherit",
        color: tint,
        background: "none",
        border: "none",
        boxShadow: `0 0 0 1.4px color-mix(in srgb, ${tint} 40%, transparent)`,
        borderRadius: 999,
        padding: "6px 12px",
        whiteSpace: "nowrap",
        cursor: blocked ? "default" : "pointer",
      }}
    >
      Обменять
    </button>
  );
  // No wrapper when there's nothing to caption: keeps the button the row's
  // only "Обменять"-labelled element, so anything hunting for it by its exact
  // text (as well as by tag) lands on the real control, not an ancestor `<div>`
  // that happens to repeat the same text.
  if (!blocked) return button;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
      {button}
      <span
        style={{
          fontSize: 11,
          color: "var(--tgui--hint_color)",
          textAlign: "right",
          maxWidth: 130,
          lineHeight: 1.3,
        }}
      >
        {blockedReason}
      </span>
    </div>
  );
}
