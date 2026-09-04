import { coverageHint, filterPeople, missingCoverage, type CoverageTemplate } from "@planer/shared";
import type { Employee, Shift, Template } from "../api/client";
import { categoryLabel, useEntryPalette } from "../categories";
import { initialsOf, personPalette } from "../lib/people";
import { dayOfMonth, toISODate, weekdayShort } from "../lib/week";
import { isDayOff, type DayCalendar } from "@planer/shared";

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
  /** From `PersonSearch` in `App.tsx` — filters which rows render. Absent/empty shows everyone. */
  query?: string;
  /**
   * Праздники и рабочие субботы недели. Обязательный: сетка, забывшая праздник,
   * красит его как рабочий день, а сервер в этот день записи уже не примет.
   */
  calendar: DayCalendar;
  /**
   * Нормы дня по видам смен — из них считается подсказка «чего в дне не хватает».
   * Пусто (или норма нулевая) — подсказки нет вовсе.
   */
  coverage?: readonly CoverageTemplate[];
  /**
   * Сегодняшняя дата. Параметром, а не `new Date()` внутри: неделю рисуют и
   * тесты, и им нужен свой «сегодня». По умолчанию — день браузера.
   */
  today?: string;
}

/** «−2 Утро» под датой: чего в этом дне не хватает против нормы. */
function DayShortfall({ date, shifts, coverage }: { date: string; shifts: Shift[]; coverage: readonly CoverageTemplate[] }) {
  const missing = missingCoverage(shifts, coverage, date);
  const hint = coverageHint(missing);
  if (!hint) return null;
  return (
    <span className="day-shortfall" title={hint}>
      {missing.map((kind) => `−${kind.need - kind.have} ${kind.name}`).join(" · ")}
    </span>
  );
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
export function ScheduleGrid({ employees, shifts, templates, weekDates, calendar, onAddClick, onEntryClick, query, coverage = [], today = toISODate(new Date()) }: ScheduleGridProps) {
  // Поиск фильтрует людей, а не дни — шапка недели рисуется от полного
  // `weekDates` независимо от того, что набрано в поле.
  const visibleEmployees = filterPeople(employees, query ?? "");
  return (
    <div className="grid-scroll">
      <table className="schedule-table">
        <thead>
          <tr>
            <th className="employee-col-header">Работник</th>
            {/* Сегодняшний столбец отмечен: в сетке из семи дней это первый
                вопрос, который к ней возникает, а до этого сетка отвечала
                только «где выходные». */}
            {weekDates.map((date) => (
              <th
                key={date}
                className={[isDayOff(date, calendar) ? "weekend-col" : "", date === today ? "today-col" : ""].filter(Boolean).join(" ") || undefined}
                aria-current={date === today ? "date" : undefined}
              >
                <span className="day-col-header">
                  <span className="dow">{weekdayShort(date)}</span>
                  <span className="dom">{dayOfMonth(date)}</span>
                  {/* Подсказка под датой, а не отдельной строкой над сеткой:
                      она про конкретный день, и в семи колонках её место —
                      в своей. Молчит, пока норма не задана. */}
                  <DayShortfall date={date} shifts={shifts} coverage={coverage} />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Полный ростер непуст, а поиск нашёл нулевой — молчаливая пустая
              таблица читалась бы как «данных нет», хотя они есть и просто не
              совпали с запросом. Пустой ПОЛНЫЙ `employees` (ростер без единого
              работника) по-прежнему не рисует ничего — это другая причина, и
              подменять её этой строкой не стоит. */}
          {visibleEmployees.length === 0 && employees.length > 0 && (
            <tr>
              <td className="employees-empty" colSpan={weekDates.length + 1}>
                Никого с таким именем нет.
              </td>
            </tr>
          )}
          {visibleEmployees.map((employee) => (
            <tr key={employee.id}>
              <td className="employee-cell">
                <EmployeeCell employee={employee} />
              </td>
              {weekDates.map((date) => (
                <DayCell
                  key={date}
                  entries={entriesFor(shifts, employee.id, date)}
                  weekend={isDayOff(date, calendar)}
                  today={date === today}
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
      {/* Имя одной строкой с обрезкой: длинное «Фамилия Имя» переносилось на
          вторую и делало строку выше соседних — вся неделя после неё съезжала.
          Полное имя остаётся во всплывающей подсказке. */}
      <span className="employee-name" title={employee.displayName}>{employee.displayName}</span>
    </div>
  );
}

function DayCell({
  entries,
  weekend,
  today,
  onAdd,
  onEntryClick,
  templates,
}: {
  entries: Shift[];
  weekend: boolean;
  today: boolean;
  onAdd: () => void;
  onEntryClick: (entry: Shift) => void;
  templates: readonly Template[];
}) {
  return (
    <td className={`day-cell${weekend ? " weekend-col" : ""}${today ? " today-col" : ""}`}>
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
      {entry.unrecognisedCode ? (
        // Not «Смена»: the file said something we could not read, and the chip has
        // to say that rather than invent a kind of shift.
        <span className="chip-title">{`? «${entry.unrecognisedCode}»`}</span>
      ) : entry.start && entry.end ? (
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
