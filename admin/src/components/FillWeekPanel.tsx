import { useState } from "react";
import { isDayOff, resolveShiftTimes, takesPartInAssignment } from "@planer/shared";
import type { DayCalendar, EntryCategory } from "@planer/shared";
import { apiClient, type Employee, type NewEntryInput, type Template } from "../api/client";
import { categoryLabel } from "../categories";
import { formatDayLabel } from "../lib/week";
import { PersonPicker } from "./PersonPicker";
import { routeAuthError, useAuthRequired } from "../auth-required";

/** Категории, которые форма предлагает, — в том же порядке, что и мини-апп. */
const ORDERED_CATEGORIES: readonly EntryCategory[] = ["shift", "vacation", "sick_leave", "duty", "offsite", "business_trip", "weekend_work"];

/** Работа идёт со временем; отсутствие — без него. */
function needsTime(category: EntryCategory): boolean {
  return category === "shift" || category === "duty" || category === "offsite" || category === "weekend_work";
}

export interface FillWeekPanelProps {
  employees: readonly Employee[];
  templates: readonly Template[];
  weekDates: readonly string[];
  /** Праздники недели: «все будни» их пропускают так же, как Сб и Вс. */
  calendar: DayCalendar;
  onCancel: () => void;
  onFilled: (count: number, notified: { delivered: number; intended: number }) => Promise<void>;
}

/**
 * «Заполнить неделю»: один человек, на каждый день показанной недели — пресет,
 * категория или «выходной», и всё это одним запросом. Перенос из мини-аппа
 * (`FillWeekPanel` в `AdminScheduleScreen.tsx`) — те же варианты и тексты.
 *
 * Рядом с «＋ Добавить смену», а не вместо её диапазона: диапазон ставит ОДНО
 * и то же на подряд идущие дни, а здесь у каждого дня свой вариант — «Пн–Ср
 * день, Чт дежурство, Пт отпуск» диапазоном не выразить.
 */
export function FillWeekPanel({ employees, templates, weekDates, calendar, onCancel, onFilled }: FillWeekPanelProps) {
  const onAuthRequired = useAuthRequired();
  // Никто не выбран, в отличие от мини-аппа (там — первый в списке): у консоли
  // список с поиском и строкой «Выбран», и неделя, залитая первому по алфавиту,
  // пока админ искал нужного, — худшая ошибка, чем лишний клик.
  const [employeeId, setEmployeeId] = useState<number>(0);
  /** Выбор на день, закодированный: "" — выходной, "p:<id>" — пресет,
   *  "c:<category>" — категория без своего пресета. */
  const [byDay, setByDay] = useState<Record<string, string>>(() => Object.fromEntries(weekDates.map((iso) => [iso, ""])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenDays = weekDates.filter((iso) => byDay[iso]);
  /** Категории без пресета — предлагаются напрямую, рядом с пресетами. */
  const plainCategories = ORDERED_CATEGORIES.filter((c) => !templates.some((t) => t.category === c));

  /** Один вариант на все будни. Выходные по календарю (Сб/Вс и праздники)
   *  остаются «выходным», если их не выставить руками: общая заливка не должна
   *  молча ставить человека на выходной. "" очищает все дни. */
  function setWholeWeek(value: string) {
    setByDay(Object.fromEntries(weekDates.map((iso) => [iso, value && isDayOff(iso, calendar) ? "" : value])));
  }

  function inputFor(iso: string, choice: string): NewEntryInput | null {
    if (choice.startsWith("p:")) {
      const template = templates.find((t) => t.id === Number(choice.slice(2)));
      if (!template) return null;
      // Пятница — со своим временем пресета: тот же расчёт, что у сервера и
      // у панели одной записи.
      const times = resolveShiftTimes(template, iso);
      return { date: iso, category: template.category, employeeId, templateId: template.id, start: times.start, end: times.end, title: template.name };
    }
    const category = choice.slice(2) as EntryCategory;
    const input: NewEntryInput = { date: iso, category, employeeId };
    // Время по умолчанию — чтобы запись встала; уточняется потом на самой записи.
    if (needsTime(category)) {
      input.start = "09:00";
      input.end = "18:00";
    }
    return input;
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
    const inputs = chosenDays.map((iso) => inputFor(iso, byDay[iso]!)).filter((input): input is NewEntryInput => input !== null);
    try {
      // Один запрос, а не цикл: семь `POST /api/admin/entries` подряд — семь
      // писем человеку за одно нажатие. Bulk-ручка атомарна и шлёт одно письмо.
      const { created, notified } = await apiClient.createEntries(inputs);
      await onFilled(created, notified);
    } catch (err) {
      if (routeAuthError(err, onAuthRequired)) return;
      setError(err instanceof Error ? err.message : "Не удалось заполнить неделю");
    } finally {
      setSaving(false);
    }
  }

  const options = (iso: string | null) => (
    <>
      {templates.map((t) => {
        const times = iso ? resolveShiftTimes(t, iso) : null;
        return (
          <option key={t.id} value={`p:${t.id}`}>
            {times ? `${t.name} · ${times.start}–${times.end}` : t.name}
          </option>
        );
      })}
      {plainCategories.map((c) => (
        <option key={c} value={`c:${c}`}>
          {categoryLabel(c)}
        </option>
      ))}
    </>
  );

  return (
    <div className="panel-overlay" onClick={onCancel}>
      <div className="panel fill-week-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <span className="panel-title">Заполнить неделю</span>
          <button type="button" className="panel-close" onClick={onCancel} aria-label="Закрыть">
            ×
          </button>
        </div>

        <div className="field-group">
          {/* Не фильтруем: это ручная постановка, админ называет человека сам.
              Пометка — чтобы не выбрать по инерции того, кого бот сам никогда
              бы не поставил. Эффективное право, а не сырая галочка: наблюдатель
              вне раздачи так же, как и человек с `excludedFromAssignment`. */}
          <PersonPicker
            label="Работник"
            people={employees}
            value={employeeId}
            onChange={setEmployeeId}
            disabled={saving}
            note={(e) => (!takesPartInAssignment(e) ? "· вне назначений" : null)}
          />
        </div>

        <div className="field-group">
          <label className="field-label" htmlFor="fill-week-all">
            Все будни одним вариантом (Сб/Вс не трогаем)
          </label>
          <select
            id="fill-week-all"
            aria-label="Все будни одним вариантом"
            value=""
            disabled={saving}
            onChange={(e) => setWholeWeek(e.target.value)}
          >
            <option value="">— по дням —</option>
            {options(null)}
          </select>
        </div>

        <div className="fill-week-days">
          {weekDates.map((iso) => {
            const label = formatDayLabel(iso);
            return (
              <label key={iso} className="fill-week-day">
                <span className={isDayOff(iso, calendar) ? "fill-week-day-name off" : "fill-week-day-name"}>{label}</span>
                <select aria-label={label} value={byDay[iso] ?? ""} disabled={saving} onChange={(e) => setByDay((prev) => ({ ...prev, [iso]: e.target.value }))}>
                  <option value="">— выходной —</option>
                  {options(iso)}
                </select>
              </label>
            );
          })}
        </div>

        {error && <div className="error-text">{error}</div>}

        <div className="panel-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
            Отмена
          </button>
          {/* Без «N из M» по ходу: запрос один, и счётчик стоял бы на нуле до
              самого ответа сервера. */}
          <button type="button" className="btn btn-primary" onClick={() => void handleFill()} disabled={saving}>
            {saving ? "Сохранение…" : `Заполнить${chosenDays.length > 0 ? ` (${chosenDays.length})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
