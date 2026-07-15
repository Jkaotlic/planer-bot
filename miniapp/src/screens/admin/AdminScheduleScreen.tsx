import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Avatar, Button, Cell, Input, List, Placeholder, Section, Select, Spinner } from "@telegram-apps/telegram-ui";
import { apiClient, type Employee, type NewEntryInput, type Shift, type Template } from "../../api/client";
import { CategoryChip, categoryLabel, type Category } from "../../categories";
import { CardShell, CardStack } from "../../components/Card";
import { ScreenScroll } from "../../components/ScreenScroll";
import { formatTimeRange } from "../../lib/shift";
import { initialsOf, personPalette } from "../../lib/people";
import { useIsDark } from "../../lib/theme";
import {
  addDays,
  dayOfMonth,
  formatDayLabel,
  formatWeekRangeLabel,
  mondayOf,
  toISODate,
  weekdayIndex,
  weekdayShort,
} from "../../lib/week";

/** Categories a new entry can be created with, in the order the form offers them. */
const ORDERED_CATEGORIES: readonly Category[] = ["shift", "vacation", "duty", "offsite", "business_trip", "weekend_work"];

const FRIDAY_INDEX = 4;

/** Categories that carry explicit clock times (a single-day worked entry). */
function needsTime(category: Category): boolean {
  return category === "shift" || category === "duty" || category === "offsite" || category === "weekend_work";
}

/** All-day absences that can span several days and have no clock times. */
function isMultiDay(category: Category): boolean {
  return category === "vacation" || category === "business_trip";
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

  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => toISODate(addDays(weekStart, i))), [weekStart]);
  const from = weekDates[0]!;
  const to = weekDates[6]!;

  async function loadWeek(fromIso: string, toIso: string) {
    setShifts(null);
    setShifts(await apiClient.getTeamSchedule(fromIso, toIso));
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
      .then((s) => {
        if (!cancelled) setShifts(s);
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

  return (
    <ScreenScroll>
      <div style={{ padding: "12px 4px 0" }}>
        <WeekBar label={formatWeekRangeLabel(weekStart, addDays(weekStart, 6))} onPrev={() => goWeek(-1)} onNext={() => goWeek(1)} />
        <DayStrip dates={weekDates} selected={selectedDate} onSelect={(d) => { setSelectedDate(d); setNotice(null); }} />
      </div>

      {error && <div style={{ padding: "8px 4px", color: "var(--tgui--destructive_text_color)", fontSize: 14 }}>{error}</div>}
      {notice && <div style={{ padding: "8px 4px", color: "var(--tgui--hint_color)", fontSize: 13.5 }}>{notice}</div>}

      <List>
        {editing !== null ? (
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
              dayEntries.map((s) => <EntryRow key={s.id} shift={s} onTap={() => setEditing(s)} />)
            )}
            <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              <Button size="m" mode="filled" stretched onClick={() => setEditing("new")}>
                ＋ Добавить
              </Button>
              <Button size="m" mode="bezeled" stretched loading={distributing} disabled={distributing} onClick={() => void handleDistribute()}>
                ⚖ Распределить честно
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

function EntryRow({ shift, onTap }: { shift: Shift; onTap: () => void }) {
  const name = shift.employeeName ?? "— не назначен —";
  const palette = personPalette(shift.employeeId);
  const heading = shift.title ?? categoryLabel(shift.category);
  return (
    <Cell
      onClick={onTap}
      before={<Avatar acronym={shift.employeeId != null ? initialsOf(name) : "?"} size={40} style={{ background: palette.bg, color: palette.fg }} />}
      subtitle={`${formatTimeRange(shift)} · ${heading}`}
      after={<CategoryChip category={shift.category} />}
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
  const [employeeId, setEmployeeId] = useState<number>(existing?.employeeId ?? 0);
  const [date, setDate] = useState<string>(existing?.date ?? defaultDate);
  const [endDate, setEndDate] = useState<string>(existing?.endDate ?? existing?.date ?? defaultDate);
  const [category, setCategory] = useState<Category>(existing?.category ?? "shift");
  const [templateId, setTemplateId] = useState<number | null>(templates[0]?.id ?? null);
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

  function selectCategory(next: Category) {
    setCategory(next);
    setFormError(null);
    if (next !== "shift") setCustomTime(false);
  }

  function buildInput(): NewEntryInput | null {
    const input: NewEntryInput = { date, category };
    if (employeeId) input.employeeId = employeeId;
    if (title.trim()) input.title = title.trim();

    if (category === "shift" && !customTime) {
      const template = templates.find((t) => t.id === templateId);
      if (!template) {
        setFormError("Выберите пресет или укажите своё время");
        return null;
      }
      const times = templateTimes(template);
      input.templateId = template.id;
      input.start = times.start;
      input.end = times.end;
      if (!input.title) input.title = template.name;
    } else if (needsTime(category)) {
      if (!start || !end) {
        setFormError("Укажите время начала и окончания");
        return null;
      }
      input.start = start;
      input.end = end;
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

      {category === "shift" && !customTime && (
        <>
          <Select header={`Пресет${isFriday ? " · пятница, сокращённый" : ""}`} value={templateId ?? ""} onChange={(e) => setTemplateId(Number(e.target.value))}>
            {templates.map((t) => {
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

      {category === "shift" && customTime && (
        <>
          <TimeRow start={start} end={end} onStart={setStart} onEnd={setEnd} />
          <button type="button" onClick={() => setCustomTime(false)} style={linkButtonStyle}>
            Вернуться к пресетам
          </button>
        </>
      )}

      {needsTime(category) && category !== "shift" && <TimeRow start={start} end={end} onStart={setStart} onEnd={setEnd} />}

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

      {(category === "duty" || category === "offsite") && (
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

const linkButtonStyle: CSSProperties = {
  alignSelf: "flex-start",
  border: "none",
  background: "none",
  padding: "2px 0",
  fontSize: 14,
  color: "var(--tgui--link_color)",
  cursor: "pointer",
};
