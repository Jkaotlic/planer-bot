import { useEffect, useState } from "react";
import type {
  TeamEntryView,
  WeekCell,
  WeekModel,
} from "../../lib/team-schedule";
import { splitDisplayName } from "../../lib/team-schedule";
import { weekdayShort } from "../../lib/week";
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
}: {
  model: WeekModel;
  today: string;
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
              className={`team-week__day${day === today ? " is-today" : ""}${isWeekend(day) ? " is-weekend" : ""}`}
              data-date={day}
              role="columnheader"
            >
              <b>{weekdayShort(day)}</b>
              <span>{day.slice(8, 10)}</span>
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
  onOpen,
}: {
  cell: WeekCell;
  employeeName: string;
  onOpen: () => void;
}) {
  if (!cell.primary) {
    return (
      <div
        className={`team-week__cell${isWeekend(cell.date) ? " is-weekend" : ""}`}
        role="gridcell"
        aria-label={`${employeeName}, ${cell.date}: нет записи`}
      />
    );
  }
  const palette = cell.primary.palette;
  return (
    <div className="team-week__slot" role="gridcell">
      <button
        type="button"
        className={`team-week__cell has-entry${isWeekend(cell.date) ? " is-weekend" : ""}`}
        style={
          palette
            ? { background: palette.bg, color: palette.fg }
            : { color: "var(--tgui--text_color)" }
        }
        aria-label={`${employeeName}, ${cell.date}: ${cell.entries.map((entry) => entry.title).join(", ")}`}
        onClick={onOpen}
      >
        <b>{palette?.code ?? "•"}</b>
        {cell.extraCount > 0 && <small>+{cell.extraCount}</small>}
      </button>
    </div>
  );
}

function isWeekend(day: string): boolean {
  const weekday = new Date(`${day}T12:00:00`).getDay();
  return weekday === 0 || weekday === 6;
}
