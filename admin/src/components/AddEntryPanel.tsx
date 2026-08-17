import { useMemo, useState } from "react";
import { isAbsence, resolveShiftTimes } from "@planer/shared";
import type { EntryCategory } from "@planer/shared";
import type { Employee, NewEntryInput, Shift, Template } from "../api/client";
import { ALL_CATEGORIES, categoryLabel } from "../categories";
import { dayOptions, formatDayLabel, weekdayIndex } from "../lib/week";

export interface AddEntryPanelProps {
  employees: readonly Employee[];
  templates: readonly Template[];
  weekDates: readonly string[];
  initialEmployeeId: number;
  initialDate: string;
  /** When set, the panel edits this entry in place instead of creating a new one. */
  existing?: Shift | null;
  onCancel: () => void;
  onSave: (input: NewEntryInput) => Promise<void>;
  /** Only offered while editing. */
  onDelete?: () => Promise<void>;
}

const FRIDAY_INDEX = 4;

/** Categories that need an explicit start/end (a "Смена"-style single-day entry). */
function needsTime(category: EntryCategory): boolean {
  return category === "shift" || category === "duty" || category === "offsite" || category === "weekend_work";
}

/** Modal for creating a schedule entry — or, when `existing` is passed, editing one in place. */
export function AddEntryPanel({
  employees,
  templates,
  weekDates,
  initialEmployeeId,
  initialDate,
  existing,
  onCancel,
  onSave,
  onDelete,
}: AddEntryPanelProps) {
  const presetsOf = (cat: EntryCategory): Template[] => templates.filter((t) => t.category === cat);

  const [employeeId, setEmployeeId] = useState(existing?.employeeId ?? initialEmployeeId);
  const [date, setDate] = useState(existing?.date ?? initialDate);
  const [endDate, setEndDate] = useState(existing?.endDate ?? existing?.date ?? initialDate);
  const [category, setCategory] = useState<EntryCategory>(existing?.category ?? "shift");
  // Default the preset to the one matching the entry's current title, else the
  // first preset of its category.
  const [templateId, setTemplateId] = useState<number | null>(
    templates.find((t) => t.name === existing?.title)?.id ?? presetsOf(existing?.category ?? "shift")[0]?.id ?? null,
  );
  // Editing a timed entry round-trips its exact clock times, so start in "custom" mode.
  const [customTime, setCustomTime] = useState(existing != null && existing.start != null);
  const [start, setStart] = useState(existing?.start ?? "09:00");
  const [end, setEnd] = useState(existing?.end ?? "18:00");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFriday = useMemo(() => weekdayIndex(date) === FRIDAY_INDEX, [date]);

  const categoryPresets = presetsOf(category);
  /** Preset mode applies to timed categories that actually have presets. */
  const presetMode = needsTime(category) && categoryPresets.length > 0 && !customTime;

  // Правило «в пятницу — пятничные часы» живёт в @planer/shared: пятничные часы
  // допускают null, и локальная копия этого не учитывала.
  function templateTimes(template: Template): { start: string; end: string } {
    return resolveShiftTimes(template, date);
  }

  /** Selecting a preset also prefills the place from its default location. */
  function selectPreset(template: Template) {
    setTemplateId(template.id);
    if (template.location) setTitle(template.location);
  }

  function selectCategory(next: EntryCategory) {
    setCategory(next);
    setError(null);
    setCustomTime(false);
    setTemplateId(presetsOf(next)[0]?.id ?? null);
  }

  async function handleSave() {
    setError(null);

    if (!employeeId) {
      setError("Выберите работника");
      return;
    }

    const input: NewEntryInput = { date, category, employeeId };

    if (presetMode) {
      const template = categoryPresets.find((t) => t.id === templateId) ?? categoryPresets[0];
      if (!template) {
        setError("Выберите пресет или укажите своё время");
        return;
      }
      const times = templateTimes(template);
      input.templateId = template.id;
      input.start = times.start;
      input.end = times.end;
      // The title always follows the chosen preset — otherwise editing a "День"
      // entry to the "Утро" preset would keep showing the stale old name.
      input.title = template.name;
    } else if (needsTime(category)) {
      if (!start || !end) {
        setError("Укажите время начала и окончания");
        return;
      }
      input.start = start;
      input.end = end;
      // Duty/offsite carry the place as their title; a custom-time shift has none.
      input.title = category === "duty" || category === "offsite" ? title.trim() || null : null;
    } else if (isAbsence(category)) {
      if (endDate && endDate !== date) input.endDate = endDate;
    }

    setSaving(true);
    try {
      await onSave(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить запись");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить запись");
    } finally {
      setDeleting(false);
    }
  }

  const busy = saving || deleting;

  return (
    <div className="panel-overlay" onClick={onCancel}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <span className="panel-title">{existing ? "Изменить запись" : "Добавить смену"}</span>
          <button type="button" className="panel-close" onClick={onCancel} aria-label="Закрыть">
            ×
          </button>
        </div>

        <div className="field-row">
          <div className="field-group" style={{ flex: 1 }}>
            <label className="field-label" htmlFor="entry-employee">
              Работник
            </label>
            <select
              id="entry-employee"
              value={employeeId}
              onChange={(e) => setEmployeeId(Number(e.target.value))}
            >
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="field-group" style={{ flex: 1 }}>
            <label className="field-label" htmlFor="entry-date">
              День
            </label>
            <select
              id="entry-date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setEndDate(e.target.value);
              }}
            >
              {dayOptions(weekDates, date).map((iso) => (
                <option key={iso} value={iso}>
                  {formatDayLabel(iso)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field-group">
          <span className="field-label">Категория</span>
          <div className="category-select">
            {ALL_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className={`category-option${category === c ? " selected" : ""}`}
                onClick={() => selectCategory(c)}
              >
                {categoryLabel(c)}
              </button>
            ))}
          </div>
        </div>

        {presetMode && (
          <div className="field-group">
            <span className="field-label">Пресет{isFriday ? " · пятница, сокращённый день" : ""}</span>
            <div className="preset-list">
              {categoryPresets.map((template) => {
                const times = templateTimes(template);
                return (
                  <button
                    key={template.id}
                    type="button"
                    className={`preset-option${templateId === template.id ? " selected" : ""}`}
                    onClick={() => selectPreset(template)}
                  >
                    <span className="preset-name">{template.name}</span>
                    <span className="preset-time">
                      {times.start}–{times.end}
                      {isFriday && <span className="friday-badge" style={{ marginLeft: 6 }}>пт</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <button type="button" className="custom-time-toggle" onClick={() => setCustomTime(true)}>
              Своё время
            </button>
          </div>
        )}

        {needsTime(category) && !presetMode && (
          <div className="field-group">
            <span className="field-label">Время</span>
            <div className="field-row">
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            {categoryPresets.length > 0 && (
              <button type="button" className="custom-time-toggle" onClick={() => setCustomTime(false)}>
                Вернуться к пресетам
              </button>
            )}
          </div>
        )}

        {isAbsence(category) && (
          <div className="field-group">
            <label className="field-label" htmlFor="entry-end-date">
              По какой день
            </label>
            <select id="entry-end-date" value={endDate} onChange={(e) => setEndDate(e.target.value)}>
              {dayOptions(weekDates, endDate)
                .filter((iso) => iso >= date)
                .map((iso) => (
                  <option key={iso} value={iso}>
                    {formatDayLabel(iso)}
                  </option>
                ))}
            </select>
          </div>
        )}

        {(category === "duty" || category === "offsite") && (
          <div className="field-group">
            <label className="field-label" htmlFor="entry-title">
              Место / примечание
            </label>
            <input
              id="entry-title"
              type="text"
              value={title}
              placeholder={category === "duty" ? "Например, Вавилова" : "Например, Ярмарка вакансий"}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
        )}

        {error && <div className="error-text">{error}</div>}

        <div className="panel-actions">
          {existing && onDelete && (
            <button type="button" className="btn btn-danger" onClick={() => void handleDelete()} disabled={busy}>
              {deleting ? "Удаление…" : "Удалить"}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            Отмена
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={busy}>
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
