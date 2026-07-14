import { Cell } from "@telegram-apps/telegram-ui";
import type { Shift } from "../api/client";
import { CategoryChip, categoryLabel } from "../categories";
import { formatTimeRange } from "../lib/shift";
import { DayBadge } from "./DayBadge";

export interface ShiftRowProps {
  shift: Shift;
}

/** A single row in "Мои смены": day, time (or "Весь день"), what it is, and its category. */
export function ShiftRow({ shift }: ShiftRowProps) {
  const isSwappable = shift.category === "shift";

  return (
    <Cell
      before={<DayBadge date={shift.date} endDate={shift.endDate} />}
      subtitle={shift.title ?? categoryLabel(shift.category)}
      description={!isSwappable ? <CategoryChip category={shift.category} /> : undefined}
      after={isSwappable ? <SwapChip /> : undefined}
    >
      {formatTimeRange(shift)}
    </Cell>
  );
}

/** Non-functional swap affordance — the swap flow itself is a follow-up task. */
function SwapChip() {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 13,
        fontWeight: 600,
        color: "var(--tgui--link_color)",
        boxShadow: "0 0 0 1.4px color-mix(in srgb, var(--tgui--link_color) 40%, transparent)",
        borderRadius: 999,
        padding: "6px 12px",
        whiteSpace: "nowrap",
      }}
    >
      Обменять
    </span>
  );
}
