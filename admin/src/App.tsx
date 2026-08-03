import { useEffect, useRef, useState } from "react";
import {
  apiClient,
  AuthRequiredError,
  type Employee,
  type FeedEvent,
  type RosterImportPreview,
  type RosterPersonResolution,
  type Shift,
  type Template,
  type TemplateRolesView,
} from "./api/client";
import { AddEntryPanel } from "./components/AddEntryPanel";
import { BalanceRail } from "./components/BalanceRail";
import { EventsFeed } from "./components/EventsFeed";
import { ScheduleGrid } from "./components/ScheduleGrid";
import { Sidebar, type NavKey } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { EmployeesScreen } from "./screens/EmployeesScreen";
import { ShiftKindsScreen } from "./screens/ShiftKindsScreen";
import { JournalScreen } from "./screens/JournalScreen";
import { BirthdaysScreen } from "./screens/BirthdaysScreen";
import { WeekendAdminScreen } from "./screens/WeekendAdminScreen";
import { addDays, formatWeekRangeLabel, mondayOf, toISODate } from "./lib/week";
import { readCsvFile, type CsvEncoding } from "./lib/csv-encoding";
import { BOT_USERNAME } from "./lib/bot";

interface PanelTarget {
  employeeId: number;
  date: string;
}

interface RosterImportState {
  fileName: string;
  csv: string;
  encoding: CsvEncoding;
  preview: RosterImportPreview;
  resolutions: RosterPersonResolution[];
  /** Explicitly confirmed «заменить то, что уже стоит в этом периоде». */
  overwrite: boolean;
  busy: boolean;
  error: string | null;
}

export function createInitialRosterResolutions(preview: RosterImportPreview): RosterPersonResolution[] {
  return preview.people.map((person) =>
    person.suggestedEmployeeId == null
      ? { csvName: person.csvName, action: "create" }
      : { csvName: person.csvName, action: "rename", employeeId: person.suggestedEmployeeId },
  );
}

export function validateRosterResolutions(resolutions: RosterPersonResolution[]): string | null {
  const employeeIds = resolutions
    .filter((item): item is Extract<RosterPersonResolution, { action: "rename" }> => item.action === "rename")
    .map((item) => item.employeeId);
  if (new Set(employeeIds).size !== employeeIds.length) {
    return "Один сотрудник выбран для нескольких строк CSV";
  }
  return null;
}

/**
 * Why «Применить» is blocked, or null when it isn't. An occupied period is not an
 * error — it just has to be confirmed, because applying will replace what's there.
 */
export function rosterImportBlocker(state: Pick<RosterImportState, "preview" | "overwrite" | "resolutions">): string | null {
  if (state.preview.existingCount > 0 && !state.overwrite) {
    return `За этот период уже есть ${state.preview.existingCount} записей — отметь «перезаписать», чтобы заменить их`;
  }
  return validateRosterResolutions(state.resolutions);
}

/** "1 запись" / "2 записи" / "5 записей" — the feedback line reads as Russian, not as a log. */
export function pluralRecords(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} записей`;
  if (mod10 === 1) return `${count} запись`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} записи`;
  return `${count} записей`;
}

/** App shell: sidebar nav + top bar + the schedule grid (this task's scope). */
export function App() {
  const [nav, setNav] = useState<NavKey>("schedule");
  const [weekMonday, setWeekMonday] = useState(() => mondayOf(new Date()));
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  /** Pools and preferences, for the ★ in the balance rail — it ranks by the same rule
   *  the server does, and cannot do that without them. */
  const [templateRoles, setTemplateRoles] = useState<TemplateRolesView[]>([]);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  // Две разные беды, и раньше они лежали в одном поле, которое рисовалось вместо
  // всей `main-column`. Загрузка людей и пресетов не удалась — показывать
  // действительно нечего, ни один раздел без них не работает. Не подгрузилась
  // неделя расписания — это беда одного раздела, и «Работники», «Журнал»,
  // «Выходные», «Дни рождения» обязаны открываться как ни в чём не бывало.
  const [bootError, setBootError] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [panelTarget, setPanelTarget] = useState<PanelTarget | null>(null);
  /** The entry currently open for editing (clicking a chip in the grid). */
  const [editingEntry, setEditingEntry] = useState<Shift | null>(null);
  const [rosterImport, setRosterImport] = useState<RosterImportState | null>(null);
  const [rosterNotice, setRosterNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const rosterFileInput = useRef<HTMLInputElement>(null);

  const weekDates = Array.from({ length: 7 }, (_, i) => toISODate(addDays(weekMonday, i)));
  const weekLabel = formatWeekRangeLabel(weekMonday, addDays(weekMonday, 6));

  // Employees + presets + events load once; the schedule reloads whenever the visible week changes.
  useEffect(() => {
    let cancelled = false;
    void loadBootstrap(() => cancelled);
    return () => {
      cancelled = true;
    };
    // loadBootstrap only closes over stable setters; safe to bind once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadBootstrap(cancelled: () => boolean = () => false) {
    setBootError(null);
    try {
      const [e, t, ev, roles] = await Promise.all([
        apiClient.getEmployees(),
        apiClient.getTemplates(),
        apiClient.getEvents(),
        apiClient.getTemplateRoles(),
      ]);
      if (cancelled()) return;
      setEmployees(e);
      setTemplates(t);
      setEvents(ev);
      setTemplateRoles(roles);
    } catch (err) {
      if (cancelled()) return;
      if (err instanceof AuthRequiredError) setNeedLogin(true);
      else setBootError(err instanceof Error ? err.message : "Не удалось загрузить данные");
    }
  }

  async function refreshEmployees() {
    setEmployees(await apiClient.getEmployees());
  }

  useEffect(() => {
    let cancelled = false;
    void loadWeek(() => cancelled);
    return () => {
      cancelled = true;
    };
    // weekDates is derived fresh each render from weekMonday; depend on the Monday itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekMonday]);

  /** The visible week's entries. `shifts` is dropped first: a failed reload must not
   *  leave the previous week's rows standing under the new week's dates. */
  async function loadWeek(cancelled: () => boolean = () => false) {
    const from = weekDates[0]!;
    const to = weekDates[6]!;
    setScheduleError(null);
    try {
      const s = await apiClient.getTeamSchedule(from, to);
      if (!cancelled()) setShifts(s);
    } catch (err) {
      if (cancelled()) return;
      setShifts(null);
      if (err instanceof AuthRequiredError) setNeedLogin(true);
      else setScheduleError(err instanceof Error ? err.message : "Не удалось загрузить расписание");
    }
  }

  async function refreshSchedule() {
    const from = weekDates[0]!;
    const to = weekDates[6]!;
    setShifts(await apiClient.getTeamSchedule(from, to));
  }

  async function previewRosterFile(file: File) {
    setRosterNotice(null);
    if (file.size > 1_000_000) {
      setRosterNotice({ kind: "error", text: "CSV больше 1 МБ — выбери файл поменьше" });
      return;
    }
    try {
      // NOT file.text(): that assumes UTF-8, and Excel on Windows still writes
      // windows-1251. Mojibake ФИО match nobody, so the import would silently
      // duplicate the whole team instead of updating it.
      const { text: csv, encoding } = await readCsvFile(file);
      const preview = await apiClient.previewRosterImport(csv);
      setRosterImport({
        fileName: file.name,
        csv,
        encoding,
        preview,
        resolutions: createInitialRosterResolutions(preview),
        overwrite: false,
        busy: false,
        error: null,
      });
    } catch (err) {
      if (err instanceof AuthRequiredError) setNeedLogin(true);
      else setRosterNotice({ kind: "error", text: err instanceof Error ? err.message : "Не удалось прочитать CSV" });
    }
  }

  function changeRosterResolution(index: number, value: string) {
    setRosterImport((current) => {
      if (!current) return current;
      const person = current.preview.people[index];
      if (!person) return current;
      const resolutions = [...current.resolutions];
      resolutions[index] =
        value === "create"
          ? { csvName: person.csvName, action: "create" }
          : { csvName: person.csvName, action: "rename", employeeId: Number(value) };
      return { ...current, resolutions, error: null };
    });
  }

  async function confirmRosterImport() {
    if (!rosterImport) return;
    const blocker = rosterImportBlocker(rosterImport);
    if (blocker) {
      setRosterImport({ ...rosterImport, error: blocker });
      return;
    }
    setRosterImport({ ...rosterImport, busy: true, error: null });
    try {
      const summary = await apiClient.applyRosterImport(
        rosterImport.csv,
        rosterImport.resolutions,
        rosterImport.overwrite,
      );
      setRosterImport(null);
      const parts = [`добавлено ${pluralRecords(summary.entriesInserted)}`];
      if (summary.entriesDeleted > 0) parts.push(`заменено ${pluralRecords(summary.entriesDeleted)}`);
      if (summary.cellsPreserved > 0) parts.push(`не тронуто ${pluralRecords(summary.cellsPreserved)}`);
      if (summary.employeesCreated > 0) parts.push(`новых сотрудников — ${summary.employeesCreated}`);
      // Mirror of `summaryLine` in miniapp/src/screens/admin/AdminRosterCsv.tsx.
      const expired = summary.swapsExpired;
      const tail = expired > 0
        ? `. ⚠ ${expired === 1 ? "1 заявка на обмен стала неактуальной" : `${expired} заявок на обмен стали неактуальны`} — обеим сторонам написали`
        : "";
      setRosterNotice({ kind: "success", text: `CSV загружен: ${parts.join(", ")}${tail}` });
      await Promise.all([
        refreshEmployees(),
        refreshSchedule(),
        apiClient.getEvents().then(setEvents),
      ]);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        setNeedLogin(true);
        return;
      }
      setRosterImport((current) =>
        current
          ? {
              ...current,
              busy: false,
              error: err instanceof Error ? err.message : "Не удалось применить CSV",
            }
          : current,
      );
    }
  }

  function openAddPanel(employeeId: number, date: string) {
    setPanelTarget({ employeeId, date });
  }

  /** Downloads the current calendar month's roster as CSV — same Blob+anchor pattern as the weekend payroll export. */
  async function exportRoster() {
    setRosterNotice(null);
    try {
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const to = `${y}-${String(m + 1).padStart(2, "0")}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, "0")}`;
      const csv = await apiClient.getRosterCsv(from, to);
      // BOM so Excel reads UTF-8 (Cyrillic) correctly.
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `roster-${from}_${to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      // В ту же полосу, что и отказы «Загрузить CSV» рядом: скачивание не удалось —
      // на экране от этого ничего не изменилось, и уносить с собой всю консоль
      // (`error` рисуется вместо любого раздела) ему не за что.
      if (err instanceof AuthRequiredError) setNeedLogin(true);
      else setRosterNotice({ kind: "error", text: err instanceof Error ? err.message : "Не удалось выгрузить ростер" });
    }
  }

  // Active: the roster now carries the archive too, and a former admin sitting in
  // it must not become the name in the sidebar.
  const admin = employees?.find((e) => e.isAdmin && e.isActive);
  // Archived workers don't appear in the live schedule or the add-entry picker.
  const activeEmployees = employees?.filter((e) => e.isActive) ?? null;

  if (needLogin) return <LoginScreen />;

  return (
    <div className="app-shell">
      <Sidebar active={nav} onChange={setNav} adminLabel={admin ? `${admin.address} · админ` : "Админ"} />
      <div className="main-column">
        {bootError ? (
          <div className="centered-fill">
            <span>{bootError}</span>
            <button type="button" className="btn btn-secondary" onClick={() => void loadBootstrap()}>
              Повторить
            </button>
          </div>
        ) : !employees || !templates ? (
          <div className="centered-fill">Загрузка…</div>
        ) : nav === "employees" ? (
          <EmployeesScreen employees={employees} onChanged={refreshEmployees} />
        ) : nav === "kinds" ? (
          <ShiftKindsScreen employees={employees ?? []} />
        ) : nav === "weekend" ? (
          <WeekendAdminScreen />
        ) : nav === "birthdays" ? (
          <BirthdaysScreen />
        ) : nav === "log" ? (
          <JournalScreen />
        ) : !activeEmployees ? (
          <div className="centered-fill">Загрузка…</div>
        ) : (
          <>
            <TopBar
              weekLabel={weekLabel}
              onPrevWeek={() => setWeekMonday((m) => addDays(m, -7))}
              onNextWeek={() => setWeekMonday((m) => addDays(m, 7))}
              onAddEntry={() => openAddPanel(activeEmployees[0]?.id ?? 1, weekDates[0]!)}
              onImportRoster={() => rosterFileInput.current?.click()}
              onExportRoster={() => void exportRoster()}
            />
            <input
              ref={rosterFileInput}
              className="visually-hidden"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void previewRosterFile(file);
              }}
            />
            {rosterNotice && (
              <div className={`roster-notice roster-notice-${rosterNotice.kind}`} role="status">
                {rosterNotice.text}
                <button type="button" onClick={() => setRosterNotice(null)} aria-label="Закрыть сообщение">×</button>
              </div>
            )}
            {scheduleError ? (
              // Неделя не пришла — сетку не рисуем вовсе: пустые клетки читались бы
              // как «на этой неделе никто не работает». Переключатель недель и левое
              // меню остаются на месте, так что выход отсюда есть и без F5.
              <div className="centered-fill in-section">
                <span>{scheduleError}</span>
                <button type="button" className="btn btn-secondary" onClick={() => void loadWeek()}>
                  Повторить
                </button>
              </div>
            ) : !shifts ? (
              <div className="centered-fill in-section">Загрузка…</div>
            ) : (
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
                  <BalanceRail employees={activeEmployees} shifts={shifts} templates={templates} roles={templateRoles} />
                  <EventsFeed events={events} />
                </aside>
              </div>
            )}
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

      {rosterImport && activeEmployees && (
        <div className="panel-overlay" onClick={() => !rosterImport.busy && setRosterImport(null)}>
          <section className="panel roster-import-panel" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog">
            <div className="panel-header">
              <div>
                <div className="panel-title">Загрузка расписания из CSV</div>
                <div className="roster-import-file">{rosterImport.fileName}</div>
              </div>
              <button
                type="button"
                className="panel-close"
                onClick={() => setRosterImport(null)}
                disabled={rosterImport.busy}
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>

            <div className="roster-import-summary">
              <span><b>{rosterImport.preview.from}</b> — <b>{rosterImport.preview.to}</b></span>
              <span>{rosterImport.preview.people.length} сотрудников · {pluralRecords(rosterImport.preview.entryCount)}</span>
            </div>
            <p className="roster-import-hint">
              Проверь сопоставление ФИО. До нажатия «Применить» база не меняется; импорт выполняется целиком одной транзакцией.
            </p>

            {rosterImport.encoding === "windows-1251" && (
              <p className="roster-import-hint" role="status">
                Файл сохранён в windows-1251 (так делает Excel) — прочитал его правильно, но проверь ФИО в списке ниже.
              </p>
            )}

            {rosterImport.preview.unknownsMessage && (
              // A warning, not a blocker: the month still imports, and these cells
              // land as «?» so they are visible in the grid until somebody fixes them.
              <p className="roster-import-warning" role="status">
                ⚠ {rosterImport.preview.unknownsMessage}
              </p>
            )}

            {rosterImport.preview.preservedCount > 0 && (
              <p className="roster-import-hint">
                Клеток «?» — {rosterImport.preview.preservedCount}. Это записи, которые CSV не умеет описать (работа в
                выходной, своё время, две записи в один день). Импорт их не тронет.
              </p>
            )}

            {rosterImport.preview.existingCount > 0 && (
              <label className="roster-overwrite">
                <input
                  type="checkbox"
                  checked={rosterImport.overwrite}
                  disabled={rosterImport.busy}
                  onChange={(event) =>
                    setRosterImport((current) =>
                      current ? { ...current, overwrite: event.target.checked, error: null } : current,
                    )
                  }
                />
                <span>
                  За этот период уже есть <b>{pluralRecords(rosterImport.preview.existingCount)}</b>. Перезаписать —
                  старые записи периода будут удалены и заменены содержимым файла.
                </span>
              </label>
            )}

            <div className="roster-reconcile-list">
              {rosterImport.preview.people.map((person, index) => {
                const resolution = rosterImport.resolutions[index]!;
                return (
                  <label className="roster-reconcile-row" key={`${person.csvName}-${index}`}>
                    <span>{person.csvName}</span>
                    <select
                      value={resolution.action === "create" ? "create" : String(resolution.employeeId)}
                      onChange={(event) => changeRosterResolution(index, event.target.value)}
                      disabled={rosterImport.busy}
                    >
                      <option value="create">＋ Создать нового</option>
                      {activeEmployees.map((employee) => (
                        <option value={employee.id} key={employee.id}>
                          ↔ {employee.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>

            {rosterImport.error && <div className="roster-import-error">{rosterImport.error}</div>}

            <div className="panel-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setRosterImport(null)} disabled={rosterImport.busy}>
                Отмена
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void confirmRosterImport()}
                disabled={rosterImport.busy || rosterImportBlocker(rosterImport) !== null}
                title={rosterImportBlocker(rosterImport) ?? undefined}
              >
                {rosterImport.busy
                  ? "Загружаю…"
                  : rosterImport.overwrite
                    ? "Перезаписать период"
                    : "Применить CSV"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}


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
