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
    <div style={{ width: spansRange ? 60 : 44, flex: "none", textAlign: "center", lineHeight: 1.15 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--tgui--text_color)" }}>{weekdayText}</div>
      <div style={{ fontSize: 11, color: "var(--tgui--hint_color)", marginTop: 1 }}>{dateText}</div>
    </div>
  );
}
