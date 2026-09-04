import { useState } from "react";
import {
  ABSENCE_CATEGORIES,
  CUSTOM_TIME_CATEGORIES,
  describeEntryRangePlan,
  entryRangeHint,
  isAbsence,
  planEntryRange,
  resolveShiftTimes,
  workPresets,
} from "@planer/shared";
import type { DayCalendar, EntryCategory, EntryRangeMode } from "@planer/shared";
import type { Employee, NewEntryInput, NewEntryRangeInput, Shift, Template } from "../api/client";
import { categoryLabel } from "../categories";
import { PersonPicker } from "./PersonPicker";
import { weekdayIndex } from "../lib/week";

export interface AddEntryPanelProps {
  employees: readonly Employee[];
  templates: readonly Template[];
  initialEmployeeId: number;
  initialDate: string;
  /** When set, the panel edits this entry in place instead of creating a new one. */
  existing?: Shift | null;
  onCancel: () => void;
  onSave: (input: NewEntryInput) => Promise<void>;
  /**
   * Создание на несколько дней. Отдельно от `onSave`, потому что это другая
   * ручка сервера с другим ответом (что поставилось и что пропущено). Без него
   * панель просто не предлагает диапазон — так её можно рендерить в тестах,
   * которым он не нужен.
   */
  onSaveRange?: (input: NewEntryRangeInput) => Promise<void>;
  /** Only offered while editing. */
  onDelete?: () => Promise<void>;
  /**
   * Праздники и рабочие субботы показанной недели. Обязательный, а не «по
   * умолчанию пусто»: предпросмотр, молча забывший праздники, обещал бы дни,
   * которые сервер не поставит.
   */
  calendar: DayCalendar;
}

const FRIDAY_INDEX = 4;

/**
 * Что именно человек выбрал в списке «Что ставим».
 *
 * Шага «Категория» в панели больше нет: у пресета категория своя, и спрашивать
 * её отдельно значило требовать сказать «Дежурство», чтобы увидеть дежурство.
 * Категорию приходится называть ровно в двух случаях — своё время (взять её
 * неоткуда) и отсутствие (пресетов у него не бывает).
 */
type Choice =
  | { kind: "preset"; templateId: number }
  | { kind: "custom"; category: EntryCategory }
  | { kind: "absence"; category: EntryCategory };

/** Каким выбором открыть панель: по правящейся записи или по умолчанию. */
function initialChoice(existing: Shift | null | undefined, presets: readonly Template[]): Choice {
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

/** Modal for creating schedule entries — or, when `existing` is passed, editing one in place. */
export function AddEntryPanel({
  employees,
  templates,
  initialEmployeeId,
  initialDate,
  existing,
  onCancel,
  onSave,
  onSaveRange,
  onDelete,
  calendar,
}: AddEntryPanelProps) {
  // Смены и дежурства одним списком, в порядке `sortOrder` — правило живёт в
  // `@planer/shared`, чтобы мини-апп показывал ровно тот же список.
  const presets = workPresets(templates);

  const [employeeId, setEmployeeId] = useState(existing?.employeeId ?? initialEmployeeId);
  const [from, setFrom] = useState(existing?.date ?? initialDate);
  const [to, setTo] = useState(existing?.endDate ?? existing?.date ?? initialDate);
  const [choice, setChoice] = useState<Choice>(() => initialChoice(existing, presets));
  const [start, setStart] = useState(existing?.start ?? "09:00");
  const [end, setEnd] = useState(existing?.end ?? "18:00");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [includeWeekends, setIncludeWeekends] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPreset = choice.kind === "preset" ? presets.find((t) => t.id === choice.templateId) : undefined;
  const category: EntryCategory = selectedPreset?.category ?? (choice.kind === "preset" ? "shift" : choice.category);
  const absence = isAbsence(category);
  const isFriday = weekdayIndex(from) === FRIDAY_INDEX;

  /**
   * Отрезок — и у добавления, и у правки, но означает он разное.
   *
   * Добавление заполняет пустые дни (`fill`), правка переписывает занятые
   * (`rewrite`): «изменить запись» на неделю, которая молча пропускает дни, где
   * запись уже есть, не меняет ничего и выглядит поломкой.
   *
   * Отсутствие в оба режима не попадает: в базе оно живёт ОДНОЙ строкой с
   * `endDate`, и правка его срока обязана остаться правкой той же строки — уйди
   * она в расстановку, рядом со старым отпуском появился бы второй.
   */
  const mode: EntryRangeMode = existing ? "rewrite" : "fill";
  const rangeAllowed = onSaveRange != null && !(existing != null && absence);
  const isRange = to > from;

  /**
   * Предпросмотр считается той же `planEntryRange`, что применит сервер, но без
   * занятых дней: панель не знает расписание за пределами показанной недели, а
   * догадка «наверное, свободно» врала бы ровно там, где человек ей поверит.
   * Поэтому про занятые сказано словами, а точное число приходит в ответе.
   *
   * `calendar` — из недели, показанной на экране (см. `App.tsx`): предпросмотр
   * обязан считать праздник выходным ровно так же, как посчитает сервер, иначе
   * он пообещает пять дней там, где встанет четыре.
   */
  const plan = planEntryRange({ from, to, category, includeWeekends, mode, calendar });

  function selectPreset(template: Template) {
    setChoice({ kind: "preset", templateId: template.id });
    setError(null);
    // Место пресета приезжает в подпись — то же, что делал прежний выбор пресета.
    if (template.location) setTitle(template.location);
  }

  function selectCustom() {
    setChoice({ kind: "custom", category: category === "shift" || !isAbsence(category) ? category : "shift" });
    setError(null);
  }

  function selectAbsence(next: EntryCategory) {
    setChoice({ kind: "absence", category: next });
    setError(null);
  }

  /** Общая часть тела для обеих ручек — одна, чтобы они не разъехались. */
  function entryFields(): Omit<NewEntryInput, "date"> & { templateId?: number } {
    if (selectedPreset) {
      const times = resolveShiftTimes(selectedPreset, from);
      return {
        category: selectedPreset.category,
        templateId: selectedPreset.id,
        start: times.start,
        end: times.end,
        // Подпись всегда идёт за выбранным пресетом: иначе правка записи «День»
        // на пресет «Утро» оставила бы старое имя.
        title: selectedPreset.name,
        employeeId,
      };
    }
    if (absence) return { category, employeeId };
    return {
      category,
      start,
      end,
      // Место дежурства и мероприятия несёт подпись; у смены со своим временем её нет.
      title: category === "duty" || category === "offsite" ? title.trim() || null : null,
      employeeId,
    };
  }

  async function handleSave() {
    setError(null);
    if (!employeeId) {
      setError("Выберите работника");
      return;
    }
    if (!selectedPreset && !absence && (!start || !end)) {
      setError("Укажите время начала и окончания");
      return;
    }
    if (to < from) {
      setError("«По» не может быть раньше, чем «с»");
      return;
    }
    if (rangeAllowed && isRange && plan.days.length === 0) {
      setError("В этом диапазоне не остаётся ни одного дня");
      return;
    }

    setSaving(true);
    try {
      if (rangeAllowed && isRange) {
        await onSaveRange!({ ...entryFields(), employeeId, from, to, includeWeekends, mode });
      } else {
        const input: NewEntryInput = { ...entryFields(), date: from };
        // Полоса отсутствия — единственный случай, когда `endDate` доезжает до базы.
        if (absence && to !== from) input.endDate = to;
        await onSave(input);
      }
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
  /** «По какой день» — у отрезка и у полосы отсутствия; больше негде. */
  const showTo = rangeAllowed || (existing != null && absence);

  return (
    <div className="panel-overlay" onClick={onCancel}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <span className="panel-title">{existing ? "Изменить запись" : "Добавить запись"}</span>
          <button type="button" className="panel-close" onClick={onCancel} aria-label="Закрыть">
            ×
          </button>
        </div>

        <div className="field-row">
          <div className="field-group" style={{ flex: 1 }}>
            <PersonPicker label="Работник" people={employees} value={employeeId} onChange={setEmployeeId} />
          </div>
          <div className="field-group" style={{ flex: showTo ? 0.7 : 1 }}>
            <label className="field-label" htmlFor="entry-from">
              {showTo ? "С" : "День"}
            </label>
            {/* Настоящее поле даты, а не список дней показанной недели: до этой
                правки поставить что-нибудь на следующий месяц через панель было
                нельзя вовсе, а у отпуска, кончающегося позже воскресенья, своего
                варианта в списке не было — селект показывал первый, то есть врал. */}
            <input
              id="entry-from"
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
            <div className="field-group" style={{ flex: 0.7 }}>
              <label className="field-label" htmlFor="entry-to">
                По
              </label>
              <input id="entry-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </div>
          )}
        </div>

        <div className="field-group">
          <span className="field-label">Что ставим{isFriday ? " · пятница, сокращённый день" : ""}</span>
          {/* Смены и дежурства в одном списке, без заголовков и разделителей: до
              2026-08-21 сюда нельзя было попасть, не выбрав сперва категорию. */}
          <div className="preset-list">
            {presets.map((template) => {
              const times = resolveShiftTimes(template, from);
              return (
                <button
                  key={template.id}
                  type="button"
                  className={`preset-option${choice.kind === "preset" && choice.templateId === template.id ? " selected" : ""}`}
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
            <button
              type="button"
              className={`preset-option${choice.kind === "custom" ? " selected" : ""}`}
              onClick={selectCustom}
            >
              <span className="preset-name">Своё время</span>
            </button>
          </div>

          <span className="field-label" style={{ marginTop: 10 }}>Отсутствие</span>
          <div className="category-select">
            {ABSENCE_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className={`category-option${choice.kind === "absence" && choice.category === c ? " selected" : ""}`}
                onClick={() => selectAbsence(c)}
              >
                {categoryLabel(c)}
              </button>
            ))}
          </div>
        </div>

        {choice.kind === "custom" && (
          <div className="field-group">
            <span className="field-label">Время и вид</span>
            <div className="field-row">
              <input type="time" aria-label="Начало" value={start} onChange={(e) => setStart(e.target.value)} />
              <input type="time" aria-label="Окончание" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            {/* Здесь категорию всё-таки спрашиваем: у записи без пресета взять её
                неоткуда, и это единственное место, где она осталась вопросом. */}
            <div className="category-select" style={{ marginTop: 8 }}>
              {CUSTOM_TIME_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`category-option${category === c ? " selected" : ""}`}
                  onClick={() => setChoice({ kind: "custom", category: c })}
                >
                  {categoryLabel(c)}
                </button>
              ))}
            </div>
          </div>
        )}

        {(category === "duty" || category === "offsite") && choice.kind !== "preset" && (
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

        {rangeAllowed && isRange && !absence && (
          <div className="field-group">
            <label className="range-weekends">
              <input
                type="checkbox"
                checked={includeWeekends}
                onChange={(e) => setIncludeWeekends(e.target.checked)}
              />
              Включая выходные
            </label>
            <div className="range-preview" data-testid="range-preview">
              Поставится {describeEntryRangePlan(plan)}. {entryRangeHint(mode)}
            </div>
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
