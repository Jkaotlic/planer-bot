import type { Employee, Shift, Template } from "../api/client";
import { categoryLabel, useEntryPalette } from "../categories";
import { initialsOf, personPalette } from "../lib/people";
import { dayOfMonth, isWeekendIso, weekdayShort } from "../lib/week";

export interface ScheduleGridProps {
  employees: Employee[];
  shifts: Shift[];
  /** Presets — an entry is coloured by the accent of the preset it came from. */
  templates: readonly Template[];
  /** The 7 ISO dates of the currently displayed week, Monday first. */
  weekDates: readonly string[];
  onAddClick: (employeeId: number, date: string) => void;
  /** Clicking an existing entry opens it for editing. */
  onEntryClick: (entry: Shift) => void;
}

function endOf(s: Shift): string {
  return s.endDate ?? s.date;
}

/** Entries for a given employee that cover a given day (multi-day spans count on every covered day). */
function entriesFor(shifts: Shift[], employeeId: number, date: string): Shift[] {
  return shifts.filter((s) => s.employeeId === employeeId && s.date <= date && endOf(s) >= date);
}

function hh(time: string): string {
  return time.slice(0, 2);
}

/** The core "работники × дни" table: rows = workers, columns = week days, cells = category-colored entry chips. */
export function ScheduleGrid({ employees, shifts, templates, weekDates, onAddClick, onEntryClick }: ScheduleGridProps) {
  return (
    <div className="grid-scroll">
      <table className="schedule-table">
        <thead>
          <tr>
            <th className="employee-col-header">Работник</th>
            {weekDates.map((date) => (
              <th key={date} className={isWeekendIso(date) ? "weekend-col" : undefined}>
                <span className="day-col-header">
                  <span className="dow">{weekdayShort(date)}</span>
                  <span className="dom">{dayOfMonth(date)}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {employees.map((employee) => (
            <tr key={employee.id}>
              <td className="employee-cell">
                <EmployeeCell employee={employee} />
              </td>
              {weekDates.map((date) => (
                <DayCell
                  key={date}
                  entries={entriesFor(shifts, employee.id, date)}
                  weekend={isWeekendIso(date)}
                  onAdd={() => onAddClick(employee.id, date)}
                  onEntryClick={onEntryClick}
                  templates={templates}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmployeeCell({ employee }: { employee: Employee }) {
  const palette = personPalette(employee.id);
  return (
    <div className="employee-row">
      <span className="avatar" style={{ background: palette.bg, color: palette.fg }}>
        {initialsOf(employee.displayName)}
      </span>
      <span className="employee-name">{employee.displayName}</span>
    </div>
  );
}

function DayCell({
  entries,
  weekend,
  onAdd,
  onEntryClick,
  templates,
}: {
  entries: Shift[];
  weekend: boolean;
  onAdd: () => void;
  onEntryClick: (entry: Shift) => void;
  templates: readonly Template[];
}) {
  return (
    <td className={`day-cell${weekend ? " weekend-col" : ""}`}>
      <div className="day-cell-inner">
        {entries.length > 0 ? (
          <>
            {entries.map((entryItem) => (
              <EntryChip key={entryItem.id} entry={entryItem} templates={templates} onClick={() => onEntryClick(entryItem)} />
            ))}
            <button type="button" className="cell-add-more" onClick={onAdd} aria-label="Добавить ещё запись">
              ＋
            </button>
          </>
        ) : (
          <button type="button" className="empty-cell-add" onClick={onAdd} aria-label="Добавить смену">
            ＋
          </button>
        )}
      </div>
    </td>
  );
}

function EntryChip({ entry, templates, onClick }: { entry: Shift; templates: readonly Template[]; onClick: () => void }) {
  const palette = useEntryPalette(entry, templates);
  return (
    <button
      type="button"
      className="entry-chip"
      style={{ background: palette.bg, color: palette.fg }}
      onClick={onClick}
      title="Изменить запись"
    >
      {entry.start && entry.end ? (
        <>
          <span className="chip-time">{`${hh(entry.start)}–${hh(entry.end)}`}</span>
          <span className="chip-title">{entry.title ?? categoryLabel(entry.category)}</span>
        </>
      ) : (
        <span className="chip-title">{entry.title ?? categoryLabel(entry.category)}</span>
      )}
    </button>
  );
}
