import { useMemo, useState } from "react";
import type { EntryCategory } from "@planer/shared";
import type { Employee, NewEntryInput, Template } from "../api/client";
import { ALL_CATEGORIES, categoryLabel } from "../categories";
import { formatDayLabel, weekdayIndex } from "../lib/week";

export interface AddEntryPanelProps {
  employees: readonly Employee[];
  templates: readonly Template[];
  weekDates: readonly string[];
  initialEmployeeId: number;
  initialDate: string;
  onCancel: () => void;
  onSave: (input: NewEntryInput) => Promise<void>;
}

const FRIDAY_INDEX = 4;

/** Categories that need an explicit start/end (a "Смена"-style single-day entry). */
function needsTime(category: EntryCategory): boolean {
  return category === "shift" || category === "duty" || category === "offsite" || category === "weekend_work";
}

/** Categories that can span multiple days (no clock times). */
function isMultiDay(category: EntryCategory): boolean {
  return category === "vacation" || category === "business_trip";
}

/** Modal for creating a schedule entry for a chosen worker + day, opened from a "+" cell or the top bar. */
export function AddEntryPanel({
  employees,
  templates,
  weekDates,
  initialEmployeeId,
  initialDate,
  onCancel,
  onSave,
}: AddEntryPanelProps) {
  const [employeeId, setEmployeeId] = useState(initialEmployeeId);
  const [date, setDate] = useState(initialDate);
  const [endDate, setEndDate] = useState(initialDate);
  const [category, setCategory] = useState<EntryCategory>("shift");
  const [templateId, setTemplateId] = useState<number | null>(templates[0]?.id ?? null);
  const [customTime, setCustomTime] = useState(false);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("18:00");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFriday = useMemo(() => weekdayIndex(date) === FRIDAY_INDEX, [date]);

  function templateTimes(template: Template): { start: string; end: string } {
    return isFriday
      ? { start: template.fridayStart, end: template.fridayEnd }
      : { start: template.start, end: template.end };
  }

  function selectCategory(next: EntryCategory) {
    setCategory(next);
    setError(null);
    if (next !== "shift") {
      setCustomTime(false);
    }
  }

  async function handleSave() {
    setError(null);

    if (!employeeId) {
      setError("Выберите работника");
      return;
    }

    const input: NewEntryInput = { date, category, employeeId };
    if (title.trim()) input.title = title.trim();

    if (category === "shift" && !customTime) {
      const template = templates.find((t) => t.id === templateId);
      if (!template) {
        setError("Выберите пресет или укажите своё время");
        return;
      }
      const times = templateTimes(template);
      input.templateId = template.id;
      input.start = times.start;
      input.end = times.end;
      if (!input.title) input.title = template.name;
    } else if (needsTime(category)) {
      if (!start || !end) {
        setError("Укажите время начала и окончания");
        return;
      }
      input.start = start;
      input.end = end;
    } else if (isMultiDay(category)) {
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

  return (
    <div className="panel-overlay" onClick={onCancel}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <span className="panel-title">Добавить смену</span>
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
              {weekDates.map((iso) => (
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

        {category === "shift" && !customTime && (
          <div className="field-group">
            <span className="field-label">Пресет{isFriday ? " · пятница, сокращённый день" : ""}</span>
            <div className="preset-list">
              {templates.map((template) => {
                const times = templateTimes(template);
                return (
                  <button
                    key={template.id}
                    type="button"
                    className={`preset-option${templateId === template.id ? " selected" : ""}`}
                    onClick={() => setTemplateId(template.id)}
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

        {category === "shift" && customTime && (
          <div className="field-group">
            <span className="field-label">Своё время</span>
            <div className="field-row">
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <button type="button" className="custom-time-toggle" onClick={() => setCustomTime(false)}>
              Вернуться к пресетам
            </button>
          </div>
        )}

        {needsTime(category) && category !== "shift" && (
          <div className="field-group">
            <label className="field-label">Время</label>
            <div className="field-row">
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
        )}

        {isMultiDay(category) && (
          <div className="field-group">
            <label className="field-label" htmlFor="entry-end-date">
              По какой день
            </label>
            <select id="entry-end-date" value={endDate} onChange={(e) => setEndDate(e.target.value)}>
              {weekDates
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
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
            Отмена
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
