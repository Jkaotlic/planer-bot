import { SICK_LEAVE_PENDING_OUTLINE, SICK_LEAVE_PENDING_SCHEDULE_PALETTE, coverageHint, filterPeople, missingCoverage, missingCoverageUnlessAcked, toEntryView, type CoverageTemplate, type SpecialDay } from "@planer/shared";
import type { Employee, Shift, Template } from "../api/client";
import { categoryLabel, useEntryPalette } from "../categories";
import { initialsOf, personPalette } from "../lib/people";
import { dayOfMonth, weekdayShort } from "../lib/week";
import { useTeamToday } from "../lib/team-today";
import { isDayOff, type DayCalendar } from "@planer/shared";

export interface ScheduleGridProps {
  employees: Employee[];
  shifts: Shift[];
  /** Presets — an entry is coloured by the accent of the preset it came from. */
  templates: readonly Template[];
  /** The 7 ISO dates of the currently displayed week, Monday first. */
  weekDates: readonly string[];
  /** `null` — «＋» в строке «Не назначено»: панель открывается без выбранного человека. */
  onAddClick: (employeeId: number | null, date: string) => void;
  /** Clicking an existing entry opens it for editing. */
  onEntryClick: (entry: Shift) => void;
  /** From `PersonSearch` in `App.tsx` — filters which rows render. Absent/empty shows everyone. */
  query?: string;
  /**
   * Праздники и рабочие субботы недели. Обязательный: сетка, забывшая праздник,
   * красит его как рабочий день, а сервер в этот день записи уже не примет.
   */
  /** Даты с отметкой «Знаю про дату»: закрыты везде, красной шапки и метки у них нет. */
  ackedDates?: ReadonlySet<string>;
  calendar: DayCalendar;
  /**
   * Подписи праздников и рабочих суббот недели — их считает `App` из строк
   * календаря с названиями, а `calendar` (карта «дата → вид») названий не несёт.
   * Необязателен: без него колонки красятся, как раньше, но без названия.
   */
  special?: readonly SpecialDay[];
  /**
   * Нормы дня по видам смен — из них считается подсказка «чего в дне не хватает».
   * Пусто (или норма нулевая) — подсказки нет вовсе.
   */
  coverage?: readonly CoverageTemplate[];
  /**
   * Сегодняшняя дата. Параметром, а не `new Date()` внутри: неделю рисуют и
   * тесты, и им нужен свой «сегодня». По умолчанию — командная дата (`useTeamToday`).
   */
  today?: string;
  /** День, на который показали из строки нехватки над сеткой, — его колонка выделяется. */
  highlightDate?: string | null;
}

/**
 * «−3» в шапке колонки: сколько людей не хватает в этом дне против нормы.
 *
 * Одно число, а не «−2 Утро · −1 Дежурство»: перечень в колонке шириной в день
 * обрезался многоточием, и именно хвост — второй вид — терялся. Расклад по
 * видам живёт в подсказке и в строке над сеткой (`WeekShortfallBar`).
 */
const NO_ACKED: ReadonlySet<string> = new Set();

function DayShortfall({ missing }: { missing: ReturnType<typeof missingCoverage> }) {
  const hint = coverageHint(missing);
  if (!hint) return null;
  const short = missing.reduce((sum, kind) => sum + kind.need - kind.have, 0);
  return (
    <span className="day-short-badge" title={hint} aria-label={hint}>{`−${short}`}</span>
  );
}

/** Название строки без человека. «Не назначено» (строка), в отличие от «— не назначен —» (выбор в списке). */
const UNASSIGNED_LABEL = "Не назначено";

function endOf(s: Shift): string {
  return s.endDate ?? s.date;
}

/**
 * Entries for a given employee that cover a given day (multi-day spans count on every covered day).
 * `null` — записи без человека: тот же отбор, поэтому чипы и полосы в строке
 * «Не назначено» ведут себя в точности как у людей.
 */
function entriesFor(shifts: Shift[], employeeId: number | null, date: string): Shift[] {
  return shifts.filter((s) => s.employeeId === employeeId && s.date <= date && endOf(s) >= date);
}

/** «Ждёт ОК» у продления — свойство дня: дни внутри подтверждённого срока рисуются как обычные. */
function pendingOn(shift: Shift, templates: readonly Template[], date: string): boolean {
  return toEntryView(shift, templates, date).pending === true;
}

function hh(time: string): string {
  return time.slice(0, 2);
}

/** The core "работники × дни" table: rows = workers, columns = week days, cells = category-colored entry chips. */
export function ScheduleGrid({ employees, shifts, templates, weekDates, calendar, special = [], onAddClick, onEntryClick, query, coverage = [], ackedDates = NO_ACKED, today: todayProp, highlightDate = null }: ScheduleGridProps) {
  // Явный `today` — у тестов; иначе командная дата (`useTeamToday`), а не часы браузера.
  const teamToday = useTeamToday();
  const today = todayProp ?? teamToday;
  const specialByDate = new Map(special.map((d) => [d.date, d]));
  // Поиск фильтрует людей, а не дни — шапка недели рисуется от полного
  // `weekDates` независимо от того, что набрано в поле.
  const visibleEmployees = filterPeople(employees, query ?? "");
  // Строка «Не назначено» — только когда в показанной неделе есть что в ней
  // показать: пустая строка в тихой неделе была бы шумом на каждом экране.
  // Поиск её не прячет, пока запрос пуст, а с запросом оставляет, лишь если он
  // подходит к её названию — как подошёл бы к имени человека.
  const hasUnassigned = weekDates.some((date) => entriesFor(shifts, null, date).length > 0);
  const showUnassigned = hasUnassigned && filterPeople([{ displayName: UNASSIGNED_LABEL }], query ?? "").length > 0;
  return (
    <div className="grid-scroll">
      <table className="schedule-table">
        <thead>
          <tr>
            <th className="employee-col-header">Работник</th>
            {/* Сегодняшний столбец отмечен: в сетке из семи дней это первый
                вопрос, который к ней возникает, а до этого сетка отвечала
                только «где выходные». */}
            {weekDates.map((date) => {
              // Один раз на колонку: от неё зависит и красная шапка, и метка в ней.
              const missing = missingCoverageUnlessAcked(shifts, coverage, date, calendar, ackedDates);
              return (
              <th
                key={date}
                className={[isDayOff(date, calendar) ? "weekend-col" : "", missing.length > 0 ? "short-col" : "", date === today ? "today-col" : "", date === highlightDate ? "pointed-col" : ""].filter(Boolean).join(" ") || undefined}
                aria-current={date === today ? "date" : undefined}
              >
                <span className="day-col-header">
                  {/* Метка рядом с днём недели, а не строкой под датой: шапка
                      колонки с дырой остаётся той же высоты, что и без неё.
                      Молчит, пока норма не задана. */}
                  <span className="dow">
                    {weekdayShort(date)}
                    <DayShortfall missing={missing} />
                  </span>
                  <span className="dom">{dayOfMonth(date)}</span>
                  {/* Название текстом в самой шапке: подсказка по наведению
                      его не показывает ни на телефоне, ни тому, кто не наводит. */}
                  {specialByDate.get(date) && (
                    <span className="day-col-mark" title={specialByDate.get(date)!.label}>
                      {specialByDate.get(date)!.short}
                    </span>
                  )}
                </span>
              </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/* Полный ростер непуст, а поиск нашёл нулевой — молчаливая пустая
              таблица читалась бы как «данных нет», хотя они есть и просто не
              совпали с запросом. Пустой ПОЛНЫЙ `employees` (ростер без единого
              работника) по-прежнему не рисует ничего — это другая причина, и
              подменять её этой строкой не стоит. */}
          {visibleEmployees.length === 0 && !showUnassigned && employees.length > 0 && (
            <tr>
              <td className="employees-empty" colSpan={weekDates.length + 1}>
                Никого с таким именем нет.
              </td>
            </tr>
          )}
          {/* ПЕРВОЙ, над людьми, а не в конце: открытая смена — то, что надо
              закрыть, и при двадцати работниках строка внизу уезжала бы за
              первый экран ровно там, где её ищут. В тихой неделе её нет вовсе,
              так что верх таблицы у остальных не сдвигается. */}
          {showUnassigned && (
            <tr className="unassigned-row">
              <td className="employee-cell">
                <div className="employee-row">
                  {/* «?» — тот же знак, что на аватаре ничьей смены в мини-аппе. */}
                  <span className="avatar" aria-hidden="true">?</span>
                  <span className="employee-name" title={UNASSIGNED_LABEL}>{UNASSIGNED_LABEL}</span>
                </div>
              </td>
              {weekDates.map((date) => (
                <DayCell
                  key={date}
                  date={date}
                  entries={entriesFor(shifts, null, date)}
                  weekend={isDayOff(date, calendar)}
                  today={date === today}
                  pointed={date === highlightDate}
                  onAdd={() => onAddClick(null, date)}
                  onEntryClick={onEntryClick}
                  templates={templates}
                />
              ))}
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
                  date={date}
                  entries={entriesFor(shifts, employee.id, date)}
                  weekend={isDayOff(date, calendar)}
                  today={date === today}
                  pointed={date === highlightDate}
                  onAdd={() => onAddClick(employee.id, date)}
                  onEntryClick={onEntryClick}
                  templates={templates}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {/* У консоли нет легенды букв — чипы подписаны словами. Пунктир — единственное
          новое обозначение, и объяснить его нужно ровно тогда, когда он на экране. */}
      {weekDates.some((date) => shifts.some((s) => s.date <= date && endOf(s) >= date && pendingOn(s, templates, date))) && (
        <div className="grid-pending-legend">
          <span className="grid-pending-legend__sample" style={{ background: SICK_LEAVE_PENDING_SCHEDULE_PALETTE.bg, outline: SICK_LEAVE_PENDING_OUTLINE }} aria-hidden="true" />
          Больничный (ждёт ОК) — подтвердить можно в карточке или в «На подтверждение»
        </div>
      )}
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
  date,
  entries,
  weekend,
  today,
  pointed,
  onAdd,
  onEntryClick,
  templates,
}: {
  date: string;
  entries: Shift[];
  weekend: boolean;
  today: boolean;
  pointed: boolean;
  onAdd: () => void;
  onEntryClick: (entry: Shift) => void;
  templates: readonly Template[];
}) {
  return (
    <td className={`day-cell${weekend ? " weekend-col" : ""}${today ? " today-col" : ""}${pointed ? " pointed-col" : ""}`}>
      <div className="day-cell-inner">
        {entries.length > 0 ? (
          <>
            {entries.map((entryItem) => (
              <EntryChip key={entryItem.id} entry={entryItem} pending={pendingOn(entryItem, templates, date)} templates={templates} onClick={() => onEntryClick(entryItem)} />
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

function EntryChip({ entry, pending, templates, onClick }: { entry: Shift; pending: boolean; templates: readonly Template[]; onClick: () => void }) {
  const palette = useEntryPalette({ ...entry, pending }, templates);
  const label = (entry.title ?? categoryLabel(entry.category)) + (pending ? " · ждёт ОК" : "");
  return (
    <button
      type="button"
      className={`entry-chip${pending ? " is-pending" : ""}`}
      style={{ background: palette.bg, color: palette.fg, ...(pending ? { outline: SICK_LEAVE_PENDING_OUTLINE, outlineOffset: "-2px" } : {}) }}
      onClick={onClick}
      title={pending ? "Больничный ждёт ОК — открыть" : "Изменить запись"}
    >
      {entry.unrecognisedCode ? (
        // Not «Смена»: the file said something we could not read, and the chip has
        // to say that rather than invent a kind of shift.
        <span className="chip-title">{`? «${entry.unrecognisedCode}»`}</span>
      ) : entry.start && entry.end ? (
        <>
          <span className="chip-time">{`${hh(entry.start)}–${hh(entry.end)}`}</span>
          <span className="chip-title">{label}</span>
        </>
      ) : (
        <span className="chip-title">{label}</span>
      )}
    </button>
  );
}
