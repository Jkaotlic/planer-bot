import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Avatar, Button, Cell, Input, List, Placeholder, Section, Select, Spinner } from "@telegram-apps/telegram-ui";
import { apiClient, type Employee, type NewEntryInput, type Shift, type Template } from "../../api/client";
import { categoryLabel, useEntryPalette, type Category } from "../../categories";
import { CardShell, CardStack } from "../../components/Card";
import { AdminRosterCsv } from "./AdminRosterCsv";
import { ScreenScroll } from "../../components/ScreenScroll";
import { formatTimeRange } from "../../lib/shift";
import { initialsOf, personPalette } from "../../lib/people";
import { useIsDark } from "../../lib/theme";
import {
  addDays,
  dayOfMonth,
  firstName,
  formatDayLabel,
  formatWeekRangeLabel,
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

/** All-day absences that can span several days and have no clock times. */
function isMultiDay(category: Category): boolean {
  return category === "vacation" || category === "sick_leave" || category === "business_trip";
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [distributing, setDistributing] = useState(false);
  /** null = closed, "new" = add form, a Shift = editing that entry. */
  const [editing, setEditing] = useState<Shift | "new" | null>(null);
  /** When true, the day view is replaced by the "Заполнить неделю" bulk-fill flow. */
  const [fillOpen, setFillOpen] = useState(false);
  /** When true, the day view is replaced by the CSV upload/download flow. */
  const [csvOpen, setCsvOpen] = useState(false);

  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => toISODate(addDays(weekStart, i))), [weekStart]);
  const from = weekDates[0]!;
  const to = weekDates[6]!;

  async function loadWeek(fromIso: string, toIso: string) {
    setShifts(null);
    const schedule = await apiClient.getTeamSchedule(fromIso, toIso);
    setShifts(schedule.shifts);
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
    Promise.all([apiClient.getAdminEmployees(), apiClient.getTemplates()])
      .then(([emps, tmpls]) => {
        if (cancelled) return;
        setEmployees(emps.filter((e) => e.isActive));
        setTemplates(tmpls);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить данные");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Schedule reloads whenever the visible week changes.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .getTeamSchedule(from, to)
      .then((schedule) => {
        if (!cancelled) setShifts(schedule.shifts);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить расписание");
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
      const n = result.assignments.length;
      setNotice(n === 0 ? "Все смены уже распределены — свободных не было." : `Распределено смен: ${n}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось распределить");
    } finally {
      setDistributing(false);
    }
  }

  async function handleSaved() {
    setEditing(null);
    await loadWeek(from, to);
  }

  async function handleFilled(count: number) {
    setFillOpen(false);
    await loadWeek(from, to);
    setNotice(count === 0 ? "Ни одного дня не выбрано — ничего не добавлено." : `Заполнено дней: ${count}.`);
  }

  return (
    <ScreenScroll>
      {/* The week switcher and day strip drive the day view, the entry form and the
          bulk fill. The CSV screen works on whole months from the file itself, so
          leaving them up there would offer navigation that changes nothing. */}
      {!csvOpen && (
        <div style={{ padding: "12px 4px 0" }}>
          <WeekBar label={formatWeekRangeLabel(weekStart, addDays(weekStart, 6))} onPrev={() => goWeek(-1)} onNext={() => goWeek(1)} />
          <DayStrip dates={weekDates} selected={selectedDate} onSelect={(d) => { setSelectedDate(d); setNotice(null); }} />
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
                onCancel={() => setFillOpen(false)}
                onFilled={handleFilled}
              />
            </CardStack>
          </Section>
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
          />
        ) : editing !== null ? (
          <Section header={editing === "new" ? "Новая запись" : "Изменить запись"}>
            <CardStack>
              <EntryForm
                employees={employees}
                templates={templates}
                weekDates={weekDates}
                existing={editing === "new" ? null : editing}
                defaultDate={selectedDate}
                onCancel={() => setEditing(null)}
                onSaved={handleSaved}
              />
            </CardStack>
          </Section>
        ) : (
          <Section header={formatDayLabel(selectedDate)}>
            {shifts === null ? (
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
            </div>
          </Section>
        )}
      </List>
    </ScreenScroll>
  );
}

function WeekBar({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
      <Button size="s" mode="gray" onClick={onPrev} aria-label="Прошлая неделя">
        ‹
      </Button>
      <span style={{ fontWeight: 600, fontSize: 15 }}>{label}</span>
      <Button size="s" mode="gray" onClick={onNext} aria-label="Следующая неделя">
        ›
      </Button>
    </div>
  );
}

function DayStrip({ dates, selected, onSelect }: { dates: readonly string[]; selected: string; onSelect: (iso: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
      {dates.map((iso) => (
        <DayChip key={iso} iso={iso} active={iso === selected} onSelect={() => onSelect(iso)} />
      ))}
    </div>
  );
}

function DayChip({ iso, active, onSelect }: { iso: string; active: boolean; onSelect: () => void }) {
  const isDark = useIsDark();
  const weekend = weekdayIndex(iso) >= FRIDAY_INDEX + 1;
  const bg = active ? "var(--tgui--button_color)" : "var(--tgui--secondary_bg_color)";
  const fg = active ? "var(--tgui--button_text_color)" : weekend ? "var(--tgui--hint_color)" : "var(--tgui--text_color)";
  return (
    <button
      type="button"
      onClick={onSelect}
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
  weekDates: readonly string[];
  existing: Shift | null;
  defaultDate: string;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}

/**
 * Create/edit form for one schedule entry. Enforces the same category↔time
 * coupling as the desktop `AddEntryPanel`: `shift` picks a preset (or a custom
 * time), the other timed categories take explicit start/end, and the all-day
 * absences take an optional multi-day range instead.
 */
function EntryForm({ employees, templates, weekDates, existing, defaultDate, onCancel, onSaved }: EntryFormProps) {
  const initialCategory: Category = existing?.category ?? "shift";
  const [employeeId, setEmployeeId] = useState<number>(existing?.employeeId ?? 0);
  const [date, setDate] = useState<string>(existing?.date ?? defaultDate);
  const [endDate, setEndDate] = useState<string>(existing?.endDate ?? existing?.date ?? defaultDate);
  const [category, setCategory] = useState<Category>(initialCategory);
  // Default the preset to the one matching the entry's current title (so editing
  // a "День" shift and switching to presets shows "День", not always "Утро");
  // failing that, the first preset of the entry's category.
  const [templateId, setTemplateId] = useState<number | null>(
    templates.find((t) => t.name === existing?.title)?.id ??
      templates.find((t) => t.category === initialCategory)?.id ??
      templates[0]?.id ??
      null,
  );
  // Editing an existing timed entry round-trips its exact clock times, so start in "custom" mode.
  const [customTime, setCustomTime] = useState<boolean>(existing != null && existing.start != null);
  const [start, setStart] = useState<string>(existing?.start ?? "09:00");
  const [end, setEnd] = useState<string>(existing?.end ?? "18:00");
  const [title, setTitle] = useState<string>(existing?.title ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isFriday = weekdayIndex(date) === FRIDAY_INDEX;

  function templateTimes(template: Template): { start: string; end: string } {
    return isFriday ? { start: template.fridayStart, end: template.fridayEnd } : { start: template.start, end: template.end };
  }

  /** Presets the picker offers for a category — e.g. shift → Утро/День/Вечер/Ночь, duty → Поклонка. */
  function presetsFor(cat: Category): Template[] {
    return templates.filter((t) => t.category === cat);
  }

  const categoryPresets = presetsFor(category);
  // Preset mode applies only to timed categories that actually have presets; the
  // rest (offsite, weekend_work) always take explicit start/end.
  const inPresetMode = needsTime(category) && !customTime && categoryPresets.length > 0;

  /** Selecting a preset also prefills the place field from its default location (used if the admin then switches to "Своё время"). */
  function selectTemplate(id: number) {
    setTemplateId(id);
    const template = templates.find((t) => t.id === id);
    if (template?.location != null && (template.category === "duty" || template.category === "offsite")) {
      setTitle(template.location);
    }
  }

  function selectCategory(next: Category) {
    setCategory(next);
    setFormError(null);
    setCustomTime(false);
    // Reset the preset to the first one of the new category (or none).
    const first = presetsFor(next)[0] ?? null;
    setTemplateId(first?.id ?? null);
    if (first?.location != null && (next === "duty" || next === "offsite")) setTitle(first.location);
  }

  function buildInput(): NewEntryInput | null {
    const input: NewEntryInput = { date, category };
    if (employeeId) input.employeeId = employeeId;

    if (inPresetMode) {
      const template = categoryPresets.find((t) => t.id === templateId) ?? categoryPresets[0];
      if (!template) {
        setFormError("Выберите пресет или укажите своё время");
        return null;
      }
      const times = templateTimes(template);
      input.templateId = template.id;
      input.start = times.start;
      input.end = times.end;
      // The title always follows the chosen preset — otherwise editing a "День"
      // entry to the "Утро" preset would keep showing the stale old name. For the
      // duty preset the name already carries the place ("Дежурство · Поклонка").
      input.title = template.name;
    } else if (needsTime(category)) {
      if (!start || !end) {
        setFormError("Укажите время начала и окончания");
        return null;
      }
      input.start = start;
      input.end = end;
      // Duty/offsite carry the "Место / примечание" as their title; a custom-time
      // shift has none — clear any stale preset name so it isn't mislabelled.
      input.title = category === "duty" || category === "offsite" ? title.trim() || null : null;
    } else if (isMultiDay(category)) {
      if (endDate && endDate !== date) input.endDate = endDate;
    }
    return input;
  }

  async function handleSave() {
    setFormError(null);
    const input = buildInput();
    if (!input) return;
    setSaving(true);
    try {
      if (existing) await apiClient.updateEntry(existing.id, input);
      else await apiClient.createEntry(input);
      await onSaved();
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
      await apiClient.deleteEntry(existing.id);
      await onSaved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Не удалось удалить запись");
    } finally {
      setDeleting(false);
    }
  }

  const busy = saving || deleting;

  return (
    <CardShell>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Select header="Работник" value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))}>
            <option value={0}>— не назначен —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.displayName}
              </option>
            ))}
          </Select>
        </div>
        <div style={{ flex: 1 }}>
          <Select header="День" value={date} onChange={(e) => { setDate(e.target.value); setEndDate(e.target.value); }}>
            {weekDates.map((iso) => (
              <option key={iso} value={iso}>
                {formatDayLabel(iso)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Select header="Категория" value={category} onChange={(e) => selectCategory(e.target.value as Category)}>
        {ORDERED_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {categoryLabel(c)}
          </option>
        ))}
      </Select>

      {inPresetMode && (
        <>
          <Select header={`Пресет${isFriday ? " · пятница, сокращённый" : ""}`} value={templateId ?? ""} onChange={(e) => selectTemplate(Number(e.target.value))}>
            {categoryPresets.map((t) => {
              const times = templateTimes(t);
              return (
                <option key={t.id} value={t.id}>
                  {t.name} · {times.start}–{times.end}
                </option>
              );
            })}
          </Select>
          <button type="button" onClick={() => setCustomTime(true)} style={linkButtonStyle}>
            Своё время
          </button>
        </>
      )}

      {needsTime(category) && customTime && categoryPresets.length > 0 && (
        <>
          <TimeRow start={start} end={end} onStart={setStart} onEnd={setEnd} />
          <button type="button" onClick={() => setCustomTime(false)} style={linkButtonStyle}>
            Вернуться к пресетам
          </button>
        </>
      )}

      {needsTime(category) && categoryPresets.length === 0 && <TimeRow start={start} end={end} onStart={setStart} onEnd={setEnd} />}

      {isMultiDay(category) && (
        <Select header="По какой день" value={endDate} onChange={(e) => setEndDate(e.target.value)}>
          {weekDates
            .filter((iso) => iso >= date)
            .map((iso) => (
              <option key={iso} value={iso}>
                {formatDayLabel(iso)}
              </option>
            ))}
        </Select>
      )}

      {(category === "duty" || category === "offsite") && !inPresetMode && (
        <Input
          header="Место / примечание"
          placeholder={category === "duty" ? "Например, Вавилова" : "Например, Ярмарка вакансий"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
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

interface FillWeekPanelProps {
  employees: readonly Employee[];
  templates: readonly Template[];
  weekDates: readonly string[];
  /** The visible week's team schedule, used only to compute the fairness hint. */
  shifts: readonly Shift[];
  onCancel: () => void;
  onFilled: (count: number) => Promise<void>;
}

/** A worker's load on the visible week, in the very terms «Распределить честно» ranks them by. */
interface WorkerLoad {
  employee: Employee;
  byKind: Record<string, number>;
  total: number;
}

/**
 * Work entries that count toward fairness — absences don't. Mirrors
 * `countsForBalance` in @planer/shared, which the mini-app doesn't depend on.
 * Same set as `needsTime` today, but a separate rule on purpose: a timed
 * category that shouldn't skew the balance must not have to change both.
 */
function countsForBalance(category: Category): boolean {
  return category === "shift" || category === "duty" || category === "offsite" || category === "weekend_work";
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
 * "Заполнить неделю": pick a worker, choose a preset (or "выходной") per day of
 * the visible week, and create one entry per chosen day in a single pass. A
 * fairness panel shows how many shifts of each kind every worker already holds
 * this week — the very thing «Распределить честно» evens out — so the admin can
 * spread work by eye. A hint, not an enforced rule.
 */
function FillWeekPanel({ employees, templates, weekDates, shifts, onCancel, onFilled }: FillWeekPanelProps) {
  const [employeeId, setEmployeeId] = useState<number>(employees[0]?.id ?? 0);
  /** Per-day choice, encoded: "" = выходной, "p:<id>" = preset, "c:<category>" = a
   * category that has no preset (отпуск/больничный/командировка/…). Same option set
   * as the single-entry form, so both surfaces offer identical choices. */
  const [byDay, setByDay] = useState<Record<string, string>>(() =>
    Object.fromEntries(weekDates.map((iso) => [iso, ""])),
  );
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
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
      if (s.employeeId == null || s.start == null || s.end == null || !countsForBalance(s.category)) continue;
      const load = byId.get(s.employeeId);
      if (!load) continue; // entry left on an archived worker — not a candidate for new slots
      const kind = shiftKind(s, nameById);
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

  /**
   * Who «Распределить честно» would hand the next shift of each kind to, ranked
   * exactly as `distributeFairly` does: fewest of that kind, then fewest shifts
   * overall, then lowest id. It can't know who'll be free on a given day, so this
   * stays a hint.
   */
  const nextByKind = useMemo(() => {
    const out = new Map<string, number>();
    for (const kind of kinds) {
      const ranked = [...loads].sort(
        (a, b) =>
          (a.byKind[kind] ?? 0) - (b.byKind[kind] ?? 0) || a.total - b.total || a.employee.id - b.employee.id,
      );
      const first = ranked[0];
      if (first) out.set(kind, first.employee.id);
    }
    return out;
  }, [loads, kinds]);

  function templateTimesFor(template: Template, iso: string): { start: string; end: string } {
    return weekdayIndex(iso) === FRIDAY_INDEX
      ? { start: template.fridayStart, end: template.fridayEnd }
      : { start: template.start, end: template.end };
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
    setSavedCount(0);
    let filled = 0;
    try {
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
        await apiClient.createEntry(input);
        filled += 1;
        setSavedCount(filled);
      }
      await onFilled(filled);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось заполнить неделю");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CardShell>
      <Select header="Работник" value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))}>
        <option value={0}>— выберите —</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.displayName}
          </option>
        ))}
      </Select>

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
              <span style={{ flexShrink: 0, color: "var(--tgui--text_color)" }}>{firstName(l.employee.displayName)}</span>
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
      {saving && (
        <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>
          Сохранение… {savedCount} из {chosenDays.length}
        </div>
      )}

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

const linkButtonStyle: CSSProperties = {
  alignSelf: "flex-start",
  border: "none",
  background: "none",
  padding: "2px 0",
  fontSize: 14,
  color: "var(--tgui--link_color)",
  cursor: "pointer",
};
