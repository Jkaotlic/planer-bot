import { weekShortfall, weekdayShort, type NormTemplate } from "@planer/shared";
import type { Shift } from "../api/client";
import { pluralizeRu } from "../lib/people";

export interface WeekShortfallBarProps {
  shifts: readonly Shift[];
  /** Виды смен с нормой дня — те же, из которых сетка считает метку в колонке. */
  templates: readonly NormTemplate[];
  weekDates: readonly string[];
  /** День, колонка которого сейчас выделена в сетке. */
  pointedDate: string | null;
  onPointDay: (date: string | null) => void;
  onOpenKinds: () => void;
}

/**
 * «Не хватает 4: Пн Утро −1 · Чт Дежурство −2» — нехватка недели одной строкой.
 *
 * Строкой, а не панелью, и только когда есть что сказать: закрытая неделя не
 * получает ни одного узла, и экран выглядит как до этой строки. Зелёное «всё
 * закрыто» висело бы над сеткой сорок недель в году, ничего не сообщая.
 *
 * Виды без нормы — в той же строке ссылкой-кнопкой в конце, а не отдельным предупреждением:
 * это не поломка, а несделанная настройка, и кричать о ней наравне с дырой
 * в графике значило бы приучить глаз строку пропускать.
 */
export function WeekShortfallBar({ shifts, templates, weekDates, pointedDate, onPointDay, onOpenKinds }: WeekShortfallBarProps) {
  const { days, total, withoutNorm } = weekShortfall(shifts, templates, weekDates);
  if (days.length === 0 && withoutNorm.length === 0) return null;
  return (
    <div className="week-shortfall" role="status">
      {days.length > 0 && <span className="week-shortfall-total">{`Не хватает ${total}`}</span>}
      {days.map((day) => (
        <button
          key={day.date}
          type="button"
          className="week-shortfall-day"
          aria-pressed={day.date === pointedDate}
          title="Показать день в сетке"
          onClick={() => onPointDay(day.date === pointedDate ? null : day.date)}
        >
          <b>{weekdayShort(day.date)}</b>
          {` ${day.missing.map((kind) => `${kind.name} −${kind.need - kind.have}`).join(", ")}`}
        </button>
      ))}
      {withoutNorm.length > 0 && (
        <button
          type="button"
          className="week-shortfall-unset btn btn-quiet btn-compact"
          title={`Норма не задана: ${withoutNorm.map((kind) => kind.name).join(", ")}`}
          onClick={onOpenKinds}
        >
          {`без нормы: ${withoutNorm.length} ${pluralizeRu(withoutNorm.length, "вид", "вида", "видов")} →`}
        </button>
      )}
    </div>
  );
}
