import { useState } from "react";
import type {
  TeamEntryView,
  WeekCell,
  WeekModel,
} from "../../lib/team-schedule";
import { splitDisplayName } from "../../lib/team-schedule";
import { weekdayShort } from "../../lib/week";
import { TeamEntryDetails } from "./TeamEntryDetails";

export function selectWeekCellDetails(cell: WeekCell): TeamEntryView[] {
  return cell.primary ? cell.entries : [];
}

export function TeamWeekGrid({
  model,
  today,
}: {
  model: WeekModel;
  today: string;
}) {
  const [details, setDetails] = useState<TeamEntryView[]>([]);

  return (
    <>
      <div className="team-week">
        <div className="team-week__corner">Сотрудник</div>
        {model.days.map((day) => (
          <div
            key={day}
            className={`team-week__day${day === today ? " is-today" : ""}${isWeekend(day) ? " is-weekend" : ""}`}
            data-date={day}
          >
            <b>{weekdayShort(day)}</b>
            <span>{day.slice(8, 10)}</span>
          </div>
        ))}
        {model.rows.map((row) => {
          const name = splitDisplayName(row.displayName);
          return (
            <div className="team-week__row" key={row.employeeId ?? "unassigned"}>
              <div className="team-week__name">
                <b>{name.surname}</b>
                <span>{name.rest}</span>
              </div>
              {row.cells.map((cell) => (
                <WeekCellButton
                  key={`${row.employeeId ?? "open"}:${cell.date}`}
                  cell={cell}
                  onOpen={() => setDetails(selectWeekCellDetails(cell))}
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
            if (!open) setDetails([]);
          }}
        />
      )}
    </>
  );
}

function WeekCellButton({
  cell,
  onOpen,
}: {
  cell: WeekCell;
  onOpen: () => void;
}) {
  if (!cell.primary) {
    return (
      <div
        className={`team-week__cell${isWeekend(cell.date) ? " is-weekend" : ""}`}
        aria-label={`${cell.date}: нет записи`}
      />
    );
  }
  const palette = cell.primary.palette;
  return (
    <button
      type="button"
      className={`team-week__cell has-entry${isWeekend(cell.date) ? " is-weekend" : ""}`}
      style={palette ? { background: palette.bg, color: palette.fg } : undefined}
      aria-label={`${cell.date}: ${cell.entries.map((entry) => entry.title).join(", ")}`}
      onClick={onOpen}
    >
      <b>{palette?.code ?? "•"}</b>
      {cell.extraCount > 0 && <small>+{cell.extraCount}</small>}
    </button>
  );
}

function isWeekend(day: string): boolean {
  const weekday = new Date(`${day}T12:00:00`).getDay();
  return weekday === 0 || weekday === 6;
}
