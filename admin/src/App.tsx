import { useEffect, useState } from "react";
import { apiClient, type Employee, type FeedEvent, type Shift, type Template } from "./api/client";
import { AddEntryPanel } from "./components/AddEntryPanel";
import { BalanceRail } from "./components/BalanceRail";
import { EventsFeed } from "./components/EventsFeed";
import { ScheduleGrid } from "./components/ScheduleGrid";
import { Sidebar, type NavKey } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { EmployeesScreen } from "./screens/EmployeesScreen";
import { WeekendAdminScreen } from "./screens/WeekendAdminScreen";
import { addDays, firstName, formatWeekRangeLabel, mondayOf, toISODate } from "./lib/week";

interface PanelTarget {
  employeeId: number;
  date: string;
}

/** App shell: sidebar nav + top bar + the schedule grid (this task's scope). */
export function App() {
  const [nav, setNav] = useState<NavKey>("schedule");
  const [weekMonday, setWeekMonday] = useState(() => mondayOf(new Date()));
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [panelTarget, setPanelTarget] = useState<PanelTarget | null>(null);

  const weekDates = Array.from({ length: 7 }, (_, i) => toISODate(addDays(weekMonday, i)));
  const weekLabel = formatWeekRangeLabel(weekMonday, addDays(weekMonday, 6));

  // Employees + presets + events load once; the schedule reloads whenever the visible week changes.
  useEffect(() => {
    let cancelled = false;
    Promise.all([apiClient.getEmployees(), apiClient.getTemplates(), apiClient.getEvents()])
      .then(([e, t, ev]) => {
        if (!cancelled) {
          setEmployees(e);
          setTemplates(t);
          setEvents(ev);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить данные");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshEmployees() {
    setEmployees(await apiClient.getEmployees());
  }

  useEffect(() => {
    let cancelled = false;
    const from = weekDates[0]!;
    const to = weekDates[6]!;
    apiClient
      .getTeamSchedule(from, to)
      .then((s) => {
        if (!cancelled) setShifts(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить расписание");
      });
    return () => {
      cancelled = true;
    };
    // weekDates is derived fresh each render from weekMonday; depend on the Monday itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekMonday]);

  async function refreshSchedule() {
    const from = weekDates[0]!;
    const to = weekDates[6]!;
    setShifts(await apiClient.getTeamSchedule(from, to));
  }

  function openAddPanel(employeeId: number, date: string) {
    setPanelTarget({ employeeId, date });
  }

  const admin = employees?.find((e) => e.isAdmin);
  // Archived workers don't appear in the live schedule or the add-entry picker.
  const activeEmployees = employees?.filter((e) => e.isActive) ?? null;

  return (
    <div className="app-shell">
      <Sidebar active={nav} onChange={setNav} adminLabel={admin ? `${firstName(admin.displayName)} · админ` : "Админ"} />
      <div className="main-column">
        {error ? (
          <div className="centered-fill">{error}</div>
        ) : !employees || !templates ? (
          <div className="centered-fill">Загрузка…</div>
        ) : nav === "employees" ? (
          <EmployeesScreen employees={employees} onChanged={refreshEmployees} />
        ) : nav === "weekend" ? (
          <WeekendAdminScreen />
        ) : nav === "log" ? (
          <div className="centered-fill">Раздел появится в следующем шаге</div>
        ) : !activeEmployees || !shifts ? (
          <div className="centered-fill">Загрузка…</div>
        ) : (
          <>
            <TopBar
              weekLabel={weekLabel}
              onPrevWeek={() => setWeekMonday((m) => addDays(m, -7))}
              onNextWeek={() => setWeekMonday((m) => addDays(m, 7))}
              onDistributeFairly={() => {}}
              onAddEntry={() => openAddPanel(activeEmployees[0]?.id ?? 1, weekDates[0]!)}
            />
            <div className="schedule-layout">
              <ScheduleGrid employees={activeEmployees} shifts={shifts} weekDates={weekDates} onAddClick={openAddPanel} />
              <aside className="right-rail">
                <BalanceRail employees={activeEmployees} shifts={shifts} />
                <EventsFeed events={events} />
              </aside>
            </div>
          </>
        )}
      </div>

      {panelTarget && activeEmployees && templates && (
        <AddEntryPanel
          employees={activeEmployees}
          templates={templates}
          weekDates={weekDates}
          initialEmployeeId={panelTarget.employeeId}
          initialDate={panelTarget.date}
          onCancel={() => setPanelTarget(null)}
          onSave={async (input) => {
            await apiClient.createEntry(input);
            setPanelTarget(null);
            await refreshSchedule();
          }}
        />
      )}
    </div>
  );
}
