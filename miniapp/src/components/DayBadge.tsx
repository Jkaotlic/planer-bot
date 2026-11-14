import { formatShortDate, formatShortDateRange, weekdayShort } from "../lib/week";

export interface DayBadgeProps {
  date: string;
  endDate?: string | null;
}

/** Compact "weekday + short date" label used as the leading element of a shift row. */
export function DayBadge({ date, endDate }: DayBadgeProps) {
  const spansRange = !!endDate && endDate !== date;
  const weekdayText = spansRange ? `${weekdayShort(date)}–${weekdayShort(endDate)}` : weekdayShort(date);
  const dateText = spansRange ? formatShortDateRange(date, endDate) : formatShortDate(date);

  return (
    <span style={{ display: "grid", width: spansRange ? 60 : 44, flex: "none", textAlign: "center", lineHeight: 1.15 }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: "var(--tgui--text_color)" }}>{weekdayText}</span>
      <span style={{ fontSize: 11, color: "var(--app-quiet-text)", marginTop: 1 }}>{dateText}</span>
    </span>
  );
}
