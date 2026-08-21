import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Button, Cell, Input, List, Placeholder, Section, Select, Spinner } from "@telegram-apps/telegram-ui";
import { PersonPicker } from "../../components/PersonPicker";
import {
  ABSENCE_CATEGORIES,
  allowedByPool,
  countsForBalance,
  CUSTOM_TIME_CATEGORIES,
  describeEntryRangePlan,
  describeEntryRangeResult,
  isAbsence,
  planEntryRange,
  resolveShiftTimes,
  takesPartInAssignment,
  UNRECOGNISED_KIND,
  workPresets,
} from "@planer/shared";
import {
  apiClient,
  type Employee,
  type NewEntryInput,
  type Shift,
  type Template,
  type TemplateRolesView,
} from "../../api/client";
import { categoryLabel, useEntryPalette, type Category } from "../../categories";
import { BackToTodayButton } from "../../components/BackToTodayButton";
import { CardShell, CardStack } from "../../components/Card";
import { AdminRosterCsv } from "./AdminRosterCsv";
import { AdminShiftKinds } from "./AdminShiftKinds";
import { ScreenScroll } from "../../components/ScreenScroll";
import { formatTimeRange, notifyPendingNotice, withNotifyNotice } from "../../lib/shift";
import { initialsOf, personPalette } from "../../lib/people";
import { useIsDark } from "../../lib/theme";
import { createLatestRequestGate } from "../../lib/request-gate";
import {
  addDays,
  dayOfMonth,
  formatDayLabel,
  formatWeekRangeLabel,
  isCurrentPeriod,
  isWeekendIso,
  mondayOf,
  toISODate,
  weekdayIndex,
  weekdayShort,
} from "../../lib/week";

/** Categories a new entry can be created with, in the order the form offers them. */
const ORDERED_CATEGORIES: readonly Category[] = ["shift", "vacation", "sick_leave", "duty", "offsite", "business_trip", "weekend_work"];

const FRIDAY_INDEX = 4;

/** Categories that carry explicit clock times (a single-day worked entry). */
function needsTime(category: Category): boolean {
  return category === "shift" || category === "duty" || category === "offsite" || category === "weekend_work";
}

/**
 * Whether the week bar + day strip should be visible. Hidden — rather than
 * merely disabled — for every sub-flow whose own state is seeded from the
 * visible week and never re-syncs afterwards: `EntryForm`'s `date`/`endDate`
 * (seeded once from `defaultDate`/`weekDates`) and `FillWeekPanel`'s `byDay`
 * (keyed once off `weekDates`) would both go stale — pointing at a day that
 * silently stopped being an option — if the admin navigated weeks while
 * either was open. The desktop console prevents the same class of bug with a
 * full-screen overlay that blocks the week switcher entirely; this is the
 * inline equivalent, reusing the pattern this screen already applies to the
 * CSV import and «кто что может» flows.
 */
export function showsWeekSwitcher(state: {
  csvOpen: boolean;
  kindsOpen: boolean;
  fillOpen: boolean;
  editing: unknown;
}): boolean {
  return !state.csvOpen && !state.kindsOpen && !state.fillOpen && state.editing === null;
}

/** Who may take a kind of shift, and who asked for it — the two things the server
 *  applies before fairness, keyed by kind because that is how the tallies below are
 *  identified. MIRRORS `KindRoles` in the console's BalanceRail. */
export interface KindRoles {
  /** Employee ids allowed to take this kind. Empty means everyone. */
  pool: readonly number[];
  /** employeeId -> weight, higher wins. Absent means they didn't ask. */
  preference: Readonly<Record<number, number>>;
}

export function rolesByKind(roles: readonly TemplateRolesView[]): Map<string, KindRoles> {
  return new Map(roles.map((r) => [r.name, { pool: r.pool, preference: r.preference }]));
}

/**
 * Who «Распределить честно» hands the next shift of each kind to, in the server's own
 * order (`distributeFairly`): the pool as a hard filter, then fewest of that kind,
 * then who asked for it, then fewest shifts overall, then lowest id.
 *
 * The pool and the preference used to be missing here, which was harmless only while
 * no preset had a pool: the ★ would land on whoever held fewest of a duty across the
 * whole team — including people who may not take that duty at all — and the button
 * would then hand it to somebody else. A hint the admin believes has to rank by the
 * real rule.
 *
 * A kind with nobody eligible gets no entry, so no ★ at all: better a blank than a
 * name that cannot be picked. MIRRORS `nextPickByKind` in the console's BalanceRail.
 */
export function nextPickByKind(
  loads: readonly { employeeId: number; byKind: Record<string, number>; total: number }[],
  kinds: readonly string[],
  byKind: ReadonlyMap<string, KindRoles>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const kind of kinds) {
    // A kind with no preset behind it (a one-off time, an old row) has no roles, which
    // reads as "everyone" — the same as an unconfigured preset.
    const kindRoles = byKind.get(kind);
    const pool = kindRoles?.pool;
    const preferenceOf = (employeeId: number) => kindRoles?.preference[employeeId] ?? 0;
    const ranked = loads
      // An empty pool means everyone — the server's own rule, imported rather than
      // restated, so it cannot drift.
      .filter((l) => allowedByPool(pool, l.employeeId))
      .sort(
        (a, b) =>
          (a.byKind[kind] ?? 0) - (b.byKind[kind] ?? 0) ||
          preferenceOf(b.employeeId) - preferenceOf(a.employeeId) ||
          a.total - b.total ||
          a.employeeId - b.employeeId,
      );
    const first = ranked[0];
    if (first) out.set(kind, first.employeeId);
  }
  return out;
}

/**
 * What «⚖ Распределить честно» reports back.
 *
 * The count alone was a half-truth: a slot nobody could take is skipped by design,
 * so «Распределено смен: 3» over five empty cells read as success. A skipped slot
 * now gets said out loud, and the two reasons are kept apart — an emptied pool is a
 * setting to fix on «кто что может», everyone being away is just the week.
 */
export function distributeNotice(
  assigned: number,
  unfilled: readonly { kind: string; reason: "empty_pool" | "nobody_free" }[],
): string {
  const head = assigned > 0 ? `Распределено смен: ${assigned}.` : "Не распределено ни одной смены.";
  if (unfilled.length === 0) {
    return assigned > 0 ? head : "Все смены уже распределены — свободных не было.";
  }
  const brokenPools = [...new Set(unfilled.filter((s) => s.reason === "empty_pool").map((s) => s.kind))];
  if (brokenPools.length > 0) {
    const kinds = brokenPools.map((kind) => `«${kind}»`).join(", ");
    return `${head} Не удалось: ${unfilled.length}. У ${kinds} в пуле не осталось активных людей — проверь «кто что может».`;
  }
  return `${head} Не удалось: ${unfilled.length} — все, кто может, заняты или в отпуске.`;
}

/**
 * "Расписание" (admin, mobile): a day-at-a-time editor. Pick a day from the
 * week strip, see everyone working it, tap an entry to edit or delete it, add
 * new entries, and fairly auto-distribute the visible week. The desktop's
 * week grid doesn't fit a phone, so this is rebuilt day-first from the same
 * data + entry rules (`AddEntryPanel`).
 */
export function AdminScheduleScreen() {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [selectedDate, setSelectedDate] = useState<string>(() => toISODate(new Date()));
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  /** Pools and preferences, for the ★ in «Заполнить неделю» — it ranks by the same rule
   *  the server does, and cannot do that without them. */
  const [templateRoles, setTemplateRoles] = useState<TemplateRolesView[]>([]);
  const [error, setError] = useState<string | null>(null);
  /**
   * Отдельно от `error`, потому что это беда одной секции, а не экрана. Неделя,
   * которая не загрузилась, обязана сказать это на месте дня: иначе она либо
   * выдаёт день за пустой (`shifts` остались от прежней недели, ни одна запись
   * не совпадает с новым днём), либо крутит спиннер вечно (`loadWeek` снимает
   * записи первой строкой). Тот же довод, что в консоли — `admin/src/App.tsx`.
   */
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [distributing, setDistributing] = useState(false);
  /** null = closed, "new" = add form, a Shift = editing that entry. */
  const [editing, setEditing] = useState<Shift | "new" | null>(null);
  /** When true, the day view is replaced by the "Заполнить неделю" bulk-fill flow. */
  const [fillOpen, setFillOpen] = useState(false);
  /** When true, the day view is replaced by the CSV upload/download flow. */
  const [csvOpen, setCsvOpen] = useState(false);
  /** When true, the day view is replaced by the «кто что может» editor. */
  const [kindsOpen, setKindsOpen] = useState(false);

  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => toISODate(addDays(weekStart, i))), [weekStart]);
  const from = weekDates[0]!;
  const to = weekDates[6]!;
  const today = toISODate(new Date());

  // «⚖ Распределить честно» and «📅 Заполнить неделю» both hold the week they
  // started on in a closure and, being async, can still be running after the
  // admin taps to a different week. Without this, whichever fetch resolves
  // last wins outright — possibly the stale one — and the header can end up
  // showing week N+1 while the list still shows week N. Same idea as
  // `team-schedule.ts`'s gate: every fetch that ends in `setShifts` registers
  // a ticket first and only applies its result while still holding the
  // newest one.
  const gate = useRef(createLatestRequestGate());

  /** Отказ не пробрасывается: зовущие («Сохранить», «Заполнить неделю», импорт,
   *  «Распределить честно») своё дело уже сделали, и провалившееся перечитывание
   *  не повод говорить им, что не удалось сохранить. Оно докладывает о себе само —
   *  на месте дня, с кнопкой «Повторить». */
  async function loadWeek(fromIso: string, toIso: string) {
    const id = gate.current.begin();
    setShifts(null);
    setScheduleError(null);
    try {
      const schedule = await apiClient.getTeamSchedule(fromIso, toIso);
      if (gate.current.isLatest(id)) setShifts(schedule.shifts);
    } catch (err) {
      if (gate.current.isLatest(id)) setScheduleError(err instanceof Error ? err.message : "Не удалось загрузить расписание");
    }
  }

  /** A CSV import renames and creates people and rewrites entries, so both the
   *  roster and the visible week have to come back from the server. */
  async function reloadAfterImport() {
    const [emps] = await Promise.all([apiClient.getAdminEmployees(), loadWeek(from, to)]);
    setEmployees(emps.filter((e) => e.isActive));
  }

  // Roster + templates load once; they don't change with the visible week.
  useEffect(() => {
    let cancelled = false;
    Promise.all([apiClient.getAdminEmployees(), apiClient.getTemplates(), apiClient.getTemplateRoles()])
      .then(([emps, tmpls, roles]) => {
        if (cancelled) return;
        setEmployees(emps.filter((e) => e.isActive));
        setTemplates(tmpls);
        setTemplateRoles(roles);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить данные");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Schedule reloads whenever the visible week changes. Registers with the same
  // gate as `loadWeek` — navigating here must supersede a still-running
  // «Распределить честно» / «Заполнить неделю» from the week just left, exactly
  // as a second navigation here already supersedes (via `cancelled`) a first.
  useEffect(() => {
    let cancelled = false;
    const id = gate.current.begin();
    apiClient
      .getTeamSchedule(from, to)
      .then((schedule) => {
        if (cancelled || !gate.current.isLatest(id)) return;
        setShifts(schedule.shifts);
        setScheduleError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Записи прежней недели снимаем: выбранный день уже другой, ни одна из них
        // с ним не совпадёт, и экран сказал бы «в этот день ничего не запланировано»
        // про день, который просто не прочитали.
        setShifts(null);
        setScheduleError(err instanceof Error ? err.message : "Не удалось загрузить расписание");
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  function goWeek(deltaWeeks: number) {
    const nextStart = addDays(weekStart, deltaWeeks * 7);
    setWeekStart(nextStart);
    setSelectedDate(toISODate(addDays(nextStart, weekdayIndex(selectedDate))));
    setNotice(null);
  }

  /** Back to the current week AND to today. Returning to the week but leaving the
   *  selection on, say, Thursday would drop the admin on a day they never picked. */
  function goToday() {
    const todayIso = toISODate(new Date());
    setWeekStart(mondayOf(new Date()));
    setSelectedDate(todayIso);
    setNotice(null);
  }

  const dayEntries = (shifts ?? [])
    .filter((s) => s.date <= selectedDate && (s.endDate ?? s.date) >= selectedDate)
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));

  async function handleDistribute() {
    setDistributing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiClient.distribute(from, to, true);
      await loadWeek(from, to);
      setNotice(withNotifyNotice(distributeNotice(result.assignments.length, result.unfilled ?? []), result.notified));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось распределить");
    } finally {
      setDistributing(false);
    }
  }

  async function handleSaved(notified: { delivered: number; intended: number }, summary?: string) {
    setEditing(null);
    await loadWeek(from, to);
    // У одиночной записи своего сообщения об успехе нет — «дошло не до всех»
    // говорим, только когда есть что сказать, иначе экран молчит, как раньше.
    // У расстановки диапазоном есть: часть дней могла быть пропущена, и молчание
    // читалось бы как «встало всё».
    setNotice(summary ? withNotifyNotice(summary, notified) : notifyPendingNotice(notified));
  }

  async function handleFilled(count: number, notified: { delivered: number; intended: number }) {
    setFillOpen(false);
    await loadWeek(from, to);
    const base = count === 0 ? "Ни одного дня не выбрано — ничего не добавлено." : `Заполнено дней: ${count}.`;
    setNotice(count === 0 ? base : withNotifyNotice(base, notified));
  }

  return (
    <ScreenScroll>
      {/* The week switcher and day strip drive the day view, the entry form and the
          bulk fill. The CSV screen works on whole months from the file itself, so
          leaving them up there would offer navigation that changes nothing. Hidden
          (not just disabled) for the entry form and the bulk fill too — both seed
          their own state from the visible week once and never re-sync, so letting
          the admin navigate under them would leave that state pointing at a day
          that quietly isn't an option on screen anymore. */}
      {showsWeekSwitcher({ csvOpen, kindsOpen, fillOpen, editing }) && (
        <div style={{ padding: "12px 4px 0" }}>
          <WeekBar
            label={formatWeekRangeLabel(weekStart, addDays(weekStart, 6))}
            backVisible={!isCurrentPeriod("week", toISODate(weekStart), today)}
            onBack={goToday}
            onPrev={() => goWeek(-1)}
            onNext={() => goWeek(1)}
          />
          <DayStrip dates={weekDates} selected={selectedDate} today={today} onSelect={(d) => { setSelectedDate(d); setNotice(null); }} />
        </div>
      )}

      {error && <div style={{ padding: "8px 4px", color: "var(--tgui--destructive_text_color)", fontSize: 14 }}>{error}</div>}
      {notice && <div style={{ padding: "8px 4px", color: "var(--tgui--hint_color)", fontSize: 13.5 }}>{notice}</div>}

      <List>
        {fillOpen ? (
          <Section header="Заполнить неделю">
            <CardStack>
              <FillWeekPanel
                employees={employees}
                templates={templates}
                weekDates={weekDates}
                shifts={shifts ?? []}
                roles={templateRoles}
                onCancel={() => setFillOpen(false)}
                onFilled={handleFilled}
              />
            </CardStack>
          </Section>
        ) : kindsOpen ? (
          <AdminShiftKinds employees={employees} onClose={() => setKindsOpen(false)} />
        ) : csvOpen ? (
          <AdminRosterCsv
            employees={employees}
            today={selectedDate}
            onError={setError}
            onNotice={(message) => {
              setNotice(message);
              setCsvOpen(false);
            }}
            onImported={reloadAfterImport}
            onClose={() => setCsvOpen(false)}
          />
        ) : editing !== null ? (
          <Section header={editing === "new" ? "Новая запись" : "Изменить запись"}>
            <CardStack>
              <EntryForm
                employees={employees}
                templates={templates}
                existing={editing === "new" ? null : editing}
                defaultDate={selectedDate}
                onCancel={() => setEditing(null)}
                onSaved={handleSaved}
              />
            </CardStack>
          </Section>
        ) : (
          <Section header={formatDayLabel(selectedDate)}>
            {scheduleError ? (
              <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ color: "var(--tgui--destructive_text_color)", fontSize: 14 }}>{scheduleError}</span>
                <Button size="s" mode="gray" stretched onClick={() => void loadWeek(from, to)}>
                  Повторить
                </Button>
              </div>
            ) : shifts === null ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
                <Spinner size="m" />
              </div>
            ) : dayEntries.length === 0 ? (
              <Placeholder description="В этот день пока ничего не запланировано." />
            ) : (
              dayEntries.map((s) => <EntryRow key={s.id} shift={s} templates={templates} onTap={() => setEditing(s)} />)
            )}
            <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              <Button size="m" mode="filled" stretched onClick={() => setEditing("new")}>
                ＋ Добавить
              </Button>
              <Button size="m" mode="bezeled" stretched loading={distributing} disabled={distributing} onClick={() => void handleDistribute()}>
                ⚖ Распределить честно
              </Button>
              <Button size="m" mode="bezeled" stretched disabled={distributing} onClick={() => setFillOpen(true)}>
                📅 Заполнить неделю
              </Button>
              <Button size="m" mode="bezeled" stretched disabled={distributing} onClick={() => { setNotice(null); setError(null); setCsvOpen(true); }}>
                📄 График файлом (CSV)
              </Button>
              <Button size="m" mode="bezeled" stretched disabled={distributing} onClick={() => { setNotice(null); setError(null); setKindsOpen(true); }}>
                ⚙ Кто что может
              </Button>
            </div>
          </Section>
        )}
      </List>
    </ScreenScroll>
  );
}

function WeekBar({ label, backVisible, onBack, onPrev, onNext }: {
  label: string;
  /** False when the shown week already contains today. */
  backVisible: boolean;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
      <Button size="s" mode="gray" onClick={onPrev} aria-label="Прошлая неделя">
        ‹
      </Button>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{label}</span>
        {backVisible && <BackToTodayButton label="Эта неделя" onClick={onBack} />}
      </span>
      <Button size="s" mode="gray" onClick={onNext} aria-label="Следующая неделя">
        ›
      </Button>
    </div>
  );
}

function DayStrip({ dates, selected, today, onSelect }: { dates: readonly string[]; selected: string; today: string; onSelect: (iso: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
      {dates.map((iso) => (
        <DayChip key={iso} iso={iso} active={iso === selected} isToday={iso === today} onSelect={() => onSelect(iso)} />
      ))}
    </div>
  );
}

function DayChip({ iso, active, isToday, onSelect }: { iso: string; active: boolean; isToday: boolean; onSelect: () => void }) {
  const isDark = useIsDark();
  const weekend = weekdayIndex(iso) >= FRIDAY_INDEX + 1;
  const bg = active ? "var(--tgui--button_color)" : "var(--tgui--secondary_bg_color)";
  const fg = active ? "var(--tgui--button_text_color)" : weekend ? "var(--tgui--hint_color)" : "var(--tgui--text_color)";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isToday ? "date" : undefined}
      style={{
        flex: 1,
        border: "none",
        borderRadius: 12,
        padding: "8px 0",
        background: bg,
        color: fg,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        boxShadow: active ? (isDark ? "0 0 0 1px rgba(255,255,255,0.06)" : "0 1px 4px rgba(0,0,0,0.12)") : "none",
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>{weekdayShort(iso)}</span>
      <span style={{ fontSize: 15, fontWeight: 600 }}>{dayOfMonth(iso)}</span>
      {/* «Выбран» and «сегодня» were the same style, so three weeks out you
          could not tell where you were. The dot is drawn independently of the
          selection and stays visible on the selected chip too. */}
      <span
        style={{
          width: 4,
          height: 4,
          borderRadius: 999,
          background: isToday ? (active ? fg : "var(--tgui--link_color)") : "transparent",
        }}
        aria-hidden="true"
      />
    </button>
  );
}

/**
 * What the badge says. The full preset name is written for the desktop grid
 * («Дежурство · Поклонка»), and on a phone it was wide enough to push the
 * worker's name AND their hours into an ellipsis — «Даша К…», «09:00–1…».
 * The row already says it's a duty by its colour, so the badge only has to
 * carry the part that tells the duties apart.
 */
export function badgeLabel(title: string | null, category: Category): string {
  const full = title ?? categoryLabel(category);
  const [prefix, rest] = full.split(" · ");
  return rest && prefix === "Дежурство" ? rest : full;
}

function EntryRow({ shift, templates, onTap }: { shift: Shift; templates: readonly Template[]; onTap: () => void }) {
  const name = shift.employeeName ?? "— не назначен —";
  const palette = personPalette(shift.employeeId);
  // The badge shows *which* preset (Утро/День/…) in that preset's own colour, so
  // the day reads at a glance instead of every shift being the same blue.
  const entryPalette = useEntryPalette(shift, templates);
  return (
    <Cell
      onClick={onTap}
      before={<Avatar acronym={shift.employeeId != null ? initialsOf(name) : "?"} size={40} style={{ background: palette.bg, color: palette.fg }} />}
      subtitle={formatTimeRange(shift)}
      after={
        <span
          style={{
            display: "inline-block",
            fontSize: 12.5,
            fontWeight: 600,
            borderRadius: 999,
            padding: "4px 10px",
            whiteSpace: "nowrap",
            // Belt and braces: whatever the label turns out to be, the name and
            // the hours keep their room. The badge truncates before they do.
            maxWidth: 132,
            overflow: "hidden",
            textOverflow: "ellipsis",
            background: entryPalette.bg,
            color: entryPalette.fg,
          }}
        >
          {badgeLabel(shift.title, shift.category)}
        </span>
      }
    >
      {name}
    </Cell>
  );
}

interface EntryFormProps {
  employees: readonly Employee[];
  templates: readonly Template[];
  existing: Shift | null;
  defaultDate: string;
  onCancel: () => void;
  /** `summary` приходит только от расстановки диапазоном: у неё есть что сказать
   *  вслух — сколько дней встало и сколько пропущено. */
  onSaved: (notified: { delivered: number; intended: number }, summary?: string) => Promise<void>;
}

/**
 * Что именно выбрано в списке «Что ставим».
 *
 * Зеркало `Choice` из десктопной `AddEntryPanel`: у пресета категория своя, и
 * называть её отдельно приходится ровно в двух случаях — своё время (взять
 * неоткуда) и отсутствие (пресетов у него не бывает).
 */
type EntryChoice =
  | { kind: "preset"; templateId: number }
  | { kind: "custom"; category: Category }
  | { kind: "absence"; category: Category };

function initialEntryChoice(existing: Shift | null, presets: readonly Template[]): EntryChoice {
  if (existing) {
    if (existing.templateId != null && presets.some((t) => t.id === existing.templateId)) {
      return { kind: "preset", templateId: existing.templateId };
    }
    if (isAbsence(existing.category)) return { kind: "absence", category: existing.category };
    return { kind: "custom", category: existing.category };
  }
  const first = presets[0];
  return first ? { kind: "preset", templateId: first.id } : { kind: "custom", category: "shift" };
}

/**
 * Форма одной записи графика — зеркало десктопной `AddEntryPanel`, слово в слово.
 *
 * Шага «Категория» здесь больше нет: смены и дежурства идут одним списком
 * (`workPresets` из `@planer/shared` — тот же порядок, что в консоли), а
 * категория берётся из пресета. Спрашивается она ровно там, где её взять
 * неоткуда: «Своё время» и отсутствия.
 *
 * День — пара настоящих полей даты. Прежний выпадающий список предлагал семь
 * дат показанной недели, и поставить что-нибудь на следующий месяц было нельзя
 * вовсе.
 */
function EntryForm({ employees, templates, existing, defaultDate, onCancel, onSaved }: EntryFormProps) {
  const presets = workPresets(templates);

  const [employeeId, setEmployeeId] = useState<number>(existing?.employeeId ?? 0);
  const [from, setFrom] = useState<string>(existing?.date ?? defaultDate);
  const [to, setTo] = useState<string>(existing?.endDate ?? existing?.date ?? defaultDate);
  const [choice, setChoice] = useState<EntryChoice>(() => initialEntryChoice(existing, presets));
  const [start, setStart] = useState<string>(existing?.start ?? "09:00");
  const [end, setEnd] = useState<string>(existing?.end ?? "18:00");
  const [title, setTitle] = useState<string>(existing?.title ?? "");
  const [includeWeekends, setIncludeWeekends] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedPreset = choice.kind === "preset" ? presets.find((t) => t.id === choice.templateId) : undefined;
  const category: Category = selectedPreset?.category ?? (choice.kind === "preset" ? "shift" : choice.category);
  const absence = isAbsence(category);
  const isFriday = weekdayIndex(from) === FRIDAY_INDEX;

  // Диапазон — только у создания: править сразу десять записей одним движением
  // здесь не предлагается, это отдельная работа с отдельной ценой ошибки.
  const isRange = !existing && to > from;
  const showTo = !existing || absence;
  const plan = planEntryRange({ from, to, category, includeWeekends, busyDates: [] });

  /** Значение списка «Что ставим»: пресет по id, «своё время» или отсутствие по категории. */
  const choiceValue = choice.kind === "preset" ? `p:${choice.templateId}` : choice.kind === "custom" ? "custom" : `a:${choice.category}`;

  function selectChoice(value: string) {
    setFormError(null);
    if (value === "custom") {
      setChoice({ kind: "custom", category: absence ? "shift" : category });
      return;
    }
    if (value.startsWith("a:")) {
      setChoice({ kind: "absence", category: value.slice(2) as Category });
      return;
    }
    const templateId = Number(value.slice(2));
    setChoice({ kind: "preset", templateId });
    // Место пресета приезжает в подпись — пригодится, если человек потом
    // переключится на «Своё время».
    const template = presets.find((t) => t.id === templateId);
    if (template?.location != null) setTitle(template.location);
  }

  /** Общая часть тела для обеих ручек — одна, чтобы они не разъехались. */
  function entryFields(): Omit<NewEntryInput, "date"> | null {
    const base = employeeId ? { employeeId } : {};
    if (selectedPreset) {
      const times = resolveShiftTimes(selectedPreset, from);
      return {
        ...base,
        category: selectedPreset.category,
        templateId: selectedPreset.id,
        start: times.start,
        end: times.end,
        // Подпись всегда идёт за пресетом: иначе правка «Дня» на «Утро» оставила
        // бы старое имя.
        title: selectedPreset.name,
      };
    }
    if (absence) return { ...base, category };
    if (!start || !end) {
      setFormError("Укажите время начала и окончания");
      return null;
    }
    return {
      ...base,
      category,
      start,
      end,
      // Место дежурства и мероприятия несёт подпись; у смены со своим временем её нет.
      title: category === "duty" || category === "offsite" ? title.trim() || null : null,
    };
  }

  async function handleSave() {
    setFormError(null);
    if (to < from) {
      setFormError("«По» не может быть раньше, чем «с»");
      return;
    }
    if (isRange && plan.days.length === 0) {
      setFormError("В этом диапазоне не остаётся ни одного дня");
      return;
    }
    const fields = entryFields();
    if (!fields) return;

    setSaving(true);
    try {
      if (isRange) {
        if (!employeeId) {
          setFormError("Выберите работника");
          return;
        }
        const result = await apiClient.createEntryRange({ ...fields, employeeId, from, to, includeWeekends });
        await onSaved(result.notified, describeEntryRangeResult(result));
      } else {
        const input: NewEntryInput = { ...fields, date: from };
        // Полоса отсутствия — единственный случай, когда `endDate` доезжает до базы.
        if (absence && to !== from) input.endDate = to;
        const { notified } = existing
          ? await apiClient.updateEntry(existing.id, input)
          : await apiClient.createEntry(input);
        await onSaved(notified);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Не удалось сохранить запись");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!existing) return;
    setDeleting(true);
    setFormError(null);
    try {
      const { notified } = await apiClient.deleteEntry(existing.id);
      await onSaved(notified);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Не удалось удалить запись");
    } finally {
      setDeleting(false);
    }
  }

  const busy = saving || deleting;

  return (
    <CardShell>
      <PersonPicker
        label="Работник"
        people={employees}
        value={employeeId}
        onChange={setEmployeeId}
        emptyOptionLabel="— не назначен —"
      />

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Input
            header={showTo ? "С" : "День"}
            type="date"
            value={from}
            onChange={(e) => {
              const next = e.target.value;
              setFrom(next);
              if (next > to) setTo(next);
            }}
          />
        </div>
        {showTo && (
          <div style={{ flex: 1 }}>
            <Input header="По" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
      </div>

      {/* Смены и дежурства в одном списке, без шага «Категория»: до 2026-08-21
          увидеть дежурство, не сказав сперва «Дежурство», было нельзя. */}
      <Select header={`Что ставим${isFriday ? " · пятница, сокращённый" : ""}`} value={choiceValue} onChange={(e) => selectChoice(e.target.value)}>
        {presets.map((t) => {
          const times = resolveShiftTimes(t, from);
          return (
            <option key={t.id} value={`p:${t.id}`}>
              {t.name} · {times.start}–{times.end}
            </option>
          );
        })}
        <option value="custom">Своё время</option>
        {ABSENCE_CATEGORIES.map((c) => (
          <option key={c} value={`a:${c}`}>
            {categoryLabel(c as Category)}
          </option>
        ))}
      </Select>

      {choice.kind === "custom" && (
        <>
          <TimeRow start={start} end={end} onStart={setStart} onEnd={setEnd} />
          {/* Здесь категорию всё-таки спрашиваем: у записи без пресета взять её
              неоткуда, и это единственное место, где она осталась вопросом. */}
          <Select header="Вид" value={category} onChange={(e) => setChoice({ kind: "custom", category: e.target.value as Category })}>
            {CUSTOM_TIME_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c as Category)}
              </option>
            ))}
          </Select>
        </>
      )}

      {(category === "duty" || category === "offsite") && choice.kind !== "preset" && (
        <Input
          header="Место / примечание"
          placeholder={category === "duty" ? "Например, Вавилова" : "Например, Ярмарка вакансий"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      )}

      {isRange && !absence && (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
            <input type="checkbox" checked={includeWeekends} onChange={(e) => setIncludeWeekends(e.target.checked)} />
            Включая выходные
          </label>
          <div data-testid="range-preview" style={{ fontSize: 12.5, color: "var(--tgui--hint_color)", lineHeight: 1.4 }}>
            Поставится {describeEntryRangePlan(plan)}. Дни, где у человека уже что-то стоит, пропустятся.
          </div>
        </>
      )}

      {formError && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{formError}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <Button size="m" mode="filled" stretched loading={saving} disabled={busy} onClick={() => void handleSave()}>
          {existing ? "Сохранить" : "Добавить"}
        </Button>
        <Button size="m" mode="gray" disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
      </div>
      {existing && (
        <Button size="s" mode="plain" stretched loading={deleting} disabled={busy} onClick={() => void handleDelete()} style={{ color: "var(--tgui--destructive_text_color)" }}>
          Удалить запись
        </Button>
      )}
    </CardShell>
  );
}

function TimeRow({ start, end, onStart, onEnd }: { start: string; end: string; onStart: (v: string) => void; onEnd: (v: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <div style={{ flex: 1 }}>
        <Input header="Начало" type="time" value={start} onChange={(e) => onStart(e.target.value)} />
      </div>
      <div style={{ flex: 1 }}>
        <Input header="Конец" type="time" value={end} onChange={(e) => onEnd(e.target.value)} />
      </div>
    </div>
  );
}

export interface FillWeekPanelProps {
  employees: readonly Employee[];
  templates: readonly Template[];
  weekDates: readonly string[];
  /** The visible week's team schedule, used only to compute the fairness hint. */
  shifts: readonly Shift[];
  /** Pools and preferences — without them the ★ can only guess, and a guess the admin
   *  believes is worse than no hint at all. */
  roles: readonly TemplateRolesView[];
  onCancel: () => void;
  onFilled: (count: number, notified: { delivered: number; intended: number }) => Promise<void>;
}

/** A worker's load on the visible week, in the very terms «Распределить честно» ranks them by. */
interface WorkerLoad {
  employee: Employee;
  byKind: Record<string, number>;
  total: number;
}

/**
 * Which kind of shift an entry is — mirrors the server's `shiftKind`: prefer the
 * preset it came from, fall back to its title (rows that predate templateId being
 * stored), and lump one-off custom times into a single bucket.
 */
function shiftKind(s: Pick<Shift, "templateId" | "title">, nameById: ReadonlyMap<number, string>): string {
  if (s.templateId != null) {
    const name = nameById.get(s.templateId);
    if (name) return name;
  }
  return s.title ?? "Своё время";
}

/**
 * Which bucket an entry counts toward, or `null` when it counts toward none —
 * the reading half of the ★, mirroring the server's seeding.
 *
 * The unread mark is checked **before** the times, because the two are not
 * exclusive: the import writes such a cell with no times at all, but a cell edited
 * before «правка снимает пометку» kept its mark and gained hours, and the live
 * schedule holds one. Checking times first dropped the untimed ones from the count
 * entirely and filed the timed one under its title — two different disagreements
 * with the server, on the same column.
 */
export function balanceKindOf(
  s: Pick<Shift, "category" | "start" | "end" | "templateId" | "title" | "unrecognisedCode">,
  nameById: ReadonlyMap<number, string>,
): string | null {
  if (!countsForBalance(s.category)) return null;
  if (s.unrecognisedCode != null) return UNRECOGNISED_KIND;
  if (s.start == null || s.end == null) return null;
  return shiftKind(s, nameById);
}

/**
 * "Заполнить неделю": pick a worker, choose a preset (or "выходной") per day of
 * the visible week, and create one entry per chosen day in a single pass. A
 * fairness panel shows how many shifts of each kind every worker already holds
 * this week — the very thing «Распределить честно» evens out — so the admin can
 * spread work by eye. A hint, not an enforced rule.
 */
export function FillWeekPanel({ employees, templates, weekDates, shifts, roles, onCancel, onFilled }: FillWeekPanelProps) {
  const [employeeId, setEmployeeId] = useState<number>(employees[0]?.id ?? 0);
  /** Per-day choice, encoded: "" = выходной, "p:<id>" = preset, "c:<category>" = a
   * category that has no preset (отпуск/больничный/командировка/…). Same option set
   * as the single-entry form, so both surfaces offer identical choices. */
  const [byDay, setByDay] = useState<Record<string, string>>(() =>
    Object.fromEntries(weekDates.map((iso) => [iso, ""])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenDays = weekDates.filter((iso) => byDay[iso]);
  /** Categories with no preset of their own — offered directly alongside the presets. */
  const plainCategories = ORDERED_CATEGORIES.filter((c) => !templates.some((t) => t.category === c));

  // Per-kind tallies for the visible week, recomputed whenever the schedule changes.
  const { loads, kinds } = useMemo(() => {
    const nameById = new Map(templates.map((t) => [t.id, t.name]));
    const loads: WorkerLoad[] = employees.map((e) => ({ employee: e, byKind: {}, total: 0 }));
    const byId = new Map(loads.map((l) => [l.employee.id, l]));
    /** Kinds actually present this week — an all-zero row would just be noise. */
    const kinds: string[] = [];
    for (const s of shifts) {
      if (s.employeeId == null) continue;
      const kind = balanceKindOf(s, nameById);
      if (kind == null) continue;
      const load = byId.get(s.employeeId);
      if (!load) continue; // entry left on an archived worker — not a candidate for new slots
      load.byKind[kind] = (load.byKind[kind] ?? 0) + 1;
      load.total += 1;
      if (!kinds.includes(kind)) kinds.push(kind);
    }
    // Presets first, in the order this panel offers them; kinds that live only on
    // entries (old rows, one-off times) sort after them.
    const presetOrder = new Map(templates.map((t, i) => [t.name, i]));
    const rankOf = (kind: string) => presetOrder.get(kind) ?? templates.length;
    kinds.sort((a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b, "ru"));
    return { loads, kinds };
  }, [employees, shifts, templates]);

  /** Who «Распределить честно» would hand the next shift of each kind to. It can't know
   *  who'll be free on the day, so it stays a hint — but it ranks by the server's real
   *  rule, pool and preference included (see `nextPickByKind`). */
  const nextByKind = useMemo(
    () =>
      nextPickByKind(
        loads.map((l) => ({ employeeId: l.employee.id, byKind: l.byKind, total: l.total })),
        kinds,
        rolesByKind(roles),
      ),
    [loads, kinds, roles],
  );

  function templateTimesFor(template: Template, iso: string): { start: string; end: string } {
    return resolveShiftTimes(template, iso);
  }

  function setDay(iso: string, value: string) {
    setByDay((prev) => ({ ...prev, [iso]: value }));
  }

  /** Convenience: apply one choice to every WEEKDAY — Сб/Вс stay "выходной" unless
   * set by hand, since a blanket fill shouldn't silently roster the weekend.
   * Passing "" clears every day. */
  function setWholeWeek(value: string) {
    setByDay(Object.fromEntries(weekDates.map((iso) => [iso, value && isWeekendIso(iso) ? "" : value])));
  }

  async function handleFill() {
    if (!employeeId) {
      setError("Сначала выберите работника");
      return;
    }
    if (chosenDays.length === 0) {
      setError("Выберите хотя бы один день");
      return;
    }
    setError(null);
    setSaving(true);
    const inputs: NewEntryInput[] = [];
    for (const iso of chosenDays) {
      const choice = byDay[iso]!;
      let input: NewEntryInput;
      if (choice.startsWith("p:")) {
        const template = templates.find((t) => t.id === Number(choice.slice(2)));
        if (!template) continue;
        const times = templateTimesFor(template, iso);
        // Same preset→entry mapping as EntryForm: category/times from the preset,
        // title = preset name (which carries the place for a duty preset).
        input = {
          date: iso,
          category: template.category,
          employeeId,
          templateId: template.id,
          start: times.start,
          end: times.end,
          title: template.name,
        };
      } else {
        // A category with no preset: absences carry no times; a timed one gets
        // sensible defaults the admin can refine on the entry afterwards.
        const category = choice.slice(2) as Category;
        input = { date: iso, category, employeeId };
        if (needsTime(category)) {
          input.start = "09:00";
          input.end = "18:00";
        }
      }
      inputs.push(input);
    }
    try {
      // Один запрос, а не цикл: семь `POST /api/admin/entries` подряд — это семь
      // писем человеку за одно нажатие «Заполнить». Bulk-роут атомарен и шлёт
      // одно сводное письмо независимо от числа дней.
      const { created, notified } = await apiClient.createEntries(inputs);
      await onFilled(created, notified);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось заполнить неделю");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CardShell>
      {/* Не фильтруем: «Заполнить неделю» — ручная постановка, админ называет
          человека сам, и по решению заказчика это разрешено. Пометка нужна, чтобы
          не выбрать по инерции того, кого бот сам никогда бы не поставил. */}
      <PersonPicker
        label="Работник"
        people={employees}
        value={employeeId}
        onChange={setEmployeeId}
        emptyOptionLabel="— выберите —"
        // Эффективное право, не сырая галочка: наблюдатель (`isObserver`) вне
        // раздачи ровно так же, как и человек с поднятым `excludedFromAssignment`,
        // а роль его галочку не трогает — без этого он шёл бы без пометки.
        note={(e) => (!takesPartInAssignment(e) ? "· вне назначений" : null)}
      />

      {/* Fairness hint: who holds how many of each shift kind this week — exactly
          what «Распределить честно» evens out, so the panel matches the button. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 2 }}>
        <span style={{ fontSize: 13, color: "var(--tgui--hint_color)" }}>Смены на неделе по видам</span>
        {kinds.length === 0 ? (
          <span style={{ fontSize: 12.5, color: "var(--tgui--hint_color)" }}>На этой неделе смен пока нет.</span>
        ) : (
          loads.map((l) => (
            <div
              key={l.employee.id}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: 13.5 }}
            >
              <span style={{ flexShrink: 0, color: "var(--tgui--text_color)" }}>{l.employee.address}</span>
              {/* Preset names can be long ("Дежурство · Поклонка"), so the tallies wrap
                  instead of pushing the row off a phone screen. */}
              <span
                style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", columnGap: 5, rowGap: 2 }}
              >
                {kinds.map((kind, i) => {
                  const next = nextByKind.get(kind) === l.employee.id;
                  return (
                    <span
                      key={kind}
                      style={{
                        whiteSpace: "nowrap",
                        color: next ? "var(--tgui--link_color)" : "var(--tgui--hint_color)",
                        fontWeight: next ? 600 : 400,
                      }}
                    >
                      {next ? "★ " : ""}
                      {kind} {l.byKind[kind] ?? 0}
                      {/* Dot trails its own tally so a wrapped line never starts with a stray separator. */}
                      {i < kinds.length - 1 && (
                        <span style={{ color: "var(--tgui--hint_color)", fontWeight: 400 }}> ·</span>
                      )}
                    </span>
                  );
                })}
              </span>
            </div>
          ))
        )}
        {kinds.length > 0 && (
          <span style={{ fontSize: 12.5, color: "var(--tgui--hint_color)", lineHeight: 1.4 }}>
            ★ — кому «Распределить честно» отдаст следующую смену такого вида, если он свободен.
          </span>
        )}
      </div>

      <Select header="Все будни одним вариантом (Сб/Вс не трогаем)" value="" onChange={(e) => setWholeWeek(e.target.value)}>
        <option value="">— по дням —</option>
        {templates.map((t) => (
          <option key={t.id} value={`p:${t.id}`}>
            {t.name}
          </option>
        ))}
        {plainCategories.map((c) => (
          <option key={c} value={`c:${c}`}>
            {categoryLabel(c)}
          </option>
        ))}
      </Select>

      {weekDates.map((iso) => (
        <Select key={iso} header={formatDayLabel(iso)} value={byDay[iso] ?? ""} onChange={(e) => setDay(iso, e.target.value)}>
          <option value="">— выходной —</option>
          {templates.map((t) => {
            const times = templateTimesFor(t, iso);
            return (
              <option key={t.id} value={`p:${t.id}`}>
                {t.name} · {times.start}–{times.end}
              </option>
            );
          })}
          {plainCategories.map((c) => (
            <option key={c} value={`c:${c}`}>
              {categoryLabel(c)}
            </option>
          ))}
        </Select>
      ))}

      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div>}
      {/* Один запрос вместо цикла — заполняется не по одному дню, поэтому
          "N из M" посреди сохранения было бы враньём: savedCount равен нулю
          до самого ответа сервера, а не растёт по ходу. */}
      {saving && <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>Сохранение…</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <Button size="m" mode="filled" stretched loading={saving} disabled={saving} onClick={() => void handleFill()}>
          Заполнить{chosenDays.length > 0 ? ` (${chosenDays.length})` : ""}
        </Button>
        <Button size="m" mode="gray" disabled={saving} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </CardShell>
  );
}

