import { useEffect, useState } from "react";
import { categoryPaletteForTheme } from "../../categories";
import type {
  TeamEntryView,
  WeekCell,
  WeekModel,
} from "../../lib/team-schedule";
import { splitDisplayName } from "../../lib/team-schedule";
import { weekdayShort } from "../../lib/week";
import { dayOffLabel, isDayOff, type DayCalendar } from "@planer/shared";
import { TeamEntryDetails } from "./TeamEntryDetails";

export interface WeekCellSelection {
  employeeId: number | null;
  date: string;
}

export function resolveWeekCellSelection(
  model: WeekModel,
  selection: WeekCellSelection | null,
): TeamEntryView[] {
  if (!selection) return [];
  const row = model.rows.find(
    (candidate) => candidate.employeeId === selection.employeeId,
  );
  const cell = row?.cells.find((candidate) => candidate.date === selection.date);
  return cell?.primary ? cell.entries : [];
}

export function TeamWeekGrid({
  model,
  today,
  isDark,
  calendar,
}: {
  model: WeekModel;
  today: string;
  isDark: boolean;
  /** Праздники и рабочие субботы недели: серым красится выходной по календарю. */
  calendar: DayCalendar;
}) {
  const [selection, setSelection] = useState<WeekCellSelection | null>(null);
  const details = resolveWeekCellSelection(model, selection);

  useEffect(() => {
    if (selection && details.length === 0) setSelection(null);
  }, [details.length, selection]);

  return (
    <>
      <div className="team-week" role="grid" aria-label="Расписание команды на неделю">
        <div className="team-week__header" role="row">
          <div className="team-week__corner" role="columnheader">Сотрудник</div>
          {model.days.map((day) => (
            <div
              key={day}
              className={`team-week__day${day === today ? " is-today" : ""}${isDayOff(day, calendar) ? " is-weekend" : ""}`}
              data-date={day}
              aria-current={day === today ? "date" : undefined}
              role="columnheader"
            >
              <b>{weekdayShort(day)}</b>
              <span>{day.slice(8, 10)}</span>
              {/* Значок, а не название: в колонку шириной под две цифры имя
                  праздника не влезет, а `title` его показывает по нажатию. */}
              {calendar.get(day) && (
                <small title={dayOffLabel(day, calendar.get(day), null) ?? undefined}>
                  {calendar.get(day) === "holiday" ? "🎉" : "💼"}
                </small>
              )}
            </div>
          ))}
        </div>
        {model.rows.map((row) => {
          const name = splitDisplayName(row.displayName);
          return (
            <div
              className="team-week__row"
              role="row"
              key={row.employeeId ?? "unassigned"}
            >
              <div className="team-week__name" role="rowheader">
                <b>{name.surname}</b>
                <span>{name.rest}</span>
              </div>
              {row.cells.map((cell) => (
                <WeekCellButton
                  key={`${row.employeeId ?? "open"}:${cell.date}`}
                  cell={cell}
                  employeeName={row.displayName}
                  isDark={isDark}
                  isToday={cell.date === today}
                  isDayOffCell={isDayOff(cell.date, calendar)}
                  onOpen={() => {
                    setSelection({
                      employeeId: row.employeeId,
                      date: cell.date,
                    });
                  }}
                />
              ))}
            </div>
          );
        })}
      </div>
      {details.length > 0 && (
        <TeamEntryDetails
          open
          entries={details}
          onOpenChange={(open) => {
            if (!open) setSelection(null);
          }}
        />
      )}
    </>
  );
}

function WeekCellButton({
  cell,
  employeeName,
  isDark,
  isToday,
  isDayOffCell,
  onOpen,
}: {
  cell: WeekCell;
  employeeName: string;
  isDark: boolean;
  isToday: boolean;
  /** Выходной по календарю — решает шапка, клетка только красится. */
  isDayOffCell: boolean;
  onOpen: () => void;
}) {
  if (!cell.primary) {
    return (
      <div
        className={`team-week__cell${isDayOffCell ? " is-weekend" : ""}${isToday ? " is-today" : ""}`}
        role="gridcell"
        aria-label={`${employeeName}, ${cell.date}: нет записи`}
      />
    );
  }
  const exactPalette = cell.primary.palette;
  const palette = exactPalette
    ?? categoryPaletteForTheme(cell.primary.shift.category, isDark);
  return (
    <div className="team-week__slot" role="gridcell">
      <button
        type="button"
        className={`team-week__cell has-entry${isDayOffCell ? " is-weekend" : ""}${isToday ? " is-today" : ""}`}
        style={{ background: palette.bg, color: palette.fg }}
        aria-label={`${employeeName}, ${cell.date}: ${cell.entries.map((entry) => entry.title).join(", ")}`}
        onClick={onOpen}
      >
        <b>{exactPalette?.code ?? "•"}</b>
        {cell.extraCount > 0 && <small>+{cell.extraCount}</small>}
      </button>
    </div>
  );
}


