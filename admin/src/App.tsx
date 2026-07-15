import { useEffect, useState } from "react";
import { apiClient, AuthRequiredError, type Employee, type FeedEvent, type Shift, type Template } from "./api/client";
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
  const [needLogin, setNeedLogin] = useState(false);
  const [panelTarget, setPanelTarget] = useState<PanelTarget | null>(null);
  /** The entry currently open for editing (clicking a chip in the grid). */
  const [editingEntry, setEditingEntry] = useState<Shift | null>(null);

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
        if (cancelled) return;
        if (err instanceof AuthRequiredError) setNeedLogin(true);
        else setError(err instanceof Error ? err.message : "Не удалось загрузить данные");
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
        if (cancelled) return;
        if (err instanceof AuthRequiredError) setNeedLogin(true);
        else setError(err instanceof Error ? err.message : "Не удалось загрузить расписание");
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

  if (needLogin) return <LoginScreen />;

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
              <ScheduleGrid
                employees={activeEmployees}
                shifts={shifts}
                templates={templates}
                weekDates={weekDates}
                onAddClick={openAddPanel}
                onEntryClick={setEditingEntry}
              />
              <aside className="right-rail">
                <BalanceRail employees={activeEmployees} shifts={shifts} templates={templates} />
                <EventsFeed events={events} />
              </aside>
            </div>
          </>
        )}
      </div>

      {(panelTarget || editingEntry) && activeEmployees && templates && (
        <AddEntryPanel
          // Remount per target so the form re-seeds from the clicked entry.
          key={editingEntry ? `edit-${editingEntry.id}` : `new-${panelTarget?.employeeId}-${panelTarget?.date}`}
          employees={activeEmployees}
          templates={templates}
          weekDates={weekDates}
          initialEmployeeId={panelTarget?.employeeId ?? activeEmployees[0]?.id ?? 0}
          initialDate={panelTarget?.date ?? weekDates[0]!}
          existing={editingEntry}
          onCancel={() => {
            setPanelTarget(null);
            setEditingEntry(null);
          }}
          onSave={async (input) => {
            if (editingEntry) await apiClient.updateEntry(editingEntry.id, input);
            else await apiClient.createEntry(input);
            setPanelTarget(null);
            setEditingEntry(null);
            await refreshSchedule();
          }}
          onDelete={
            editingEntry
              ? async () => {
                  await apiClient.deleteEntry(editingEntry.id);
                  setEditingEntry(null);
                  await refreshSchedule();
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

const BOT_USERNAME = "your_bot_username";

/** Shown when the console has no session — points the admin at the bot's /admin login link. */
function LoginScreen() {
  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">Панель администратора</h1>
        <p className="login-text">
          Открой бота <b>@{BOT_USERNAME}</b>, отправь команду <code>/admin</code> и нажми присланную ссылку — она
          откроет эту панель уже с доступом.
        </p>
        <a className="btn btn-primary login-btn" href={`https://t.me/${BOT_USERNAME}?start=admin`} target="_blank" rel="noreferrer">
          Открыть бота
        </a>
        <p className="login-hint">Либо открой панель как веб-приложение прямо из Telegram.</p>
      </div>
    </div>
  );
}
