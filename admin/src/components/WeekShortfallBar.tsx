import { dayShortfallText, nearestShortfallLabel, shortfallStatus, weekShortfall, weekdayShort, type DayCalendar, type NormTemplate } from "@planer/shared";
import type { Shift } from "../api/client";
import { pluralizeRu } from "../lib/people";

export interface WeekShortfallBarProps {
  shifts: readonly Shift[];
  /** Виды смен с нормой дня — те же, из которых сетка считает метку в колонке. */
  templates: readonly NormTemplate[];
  weekDates: readonly string[];
  /** Праздники и рабочие выходные: от них зависит, по какой колонке нормы считать день. */
  calendar: DayCalendar;
  /** День, колонка которого сейчас выделена в сетке. */
  pointedDate: string | null;
  onPointDay: (date: string | null) => void;
  onOpenKinds: () => void;
  /** Первый день нехватки на неделю вперёд (то же число, что на пункте сайдбара). */
  nearestDate?: string | null;
  onJumpNearest?: (date: string) => void;
}

/**
 * «Не хватает 4: Пн Утро −1 · Чт Дежурство −2» — нехватка недели одной строкой.
 *
 * Стоит всегда, а не только при нехватке: молчащая подсказка неотличима от
 * отсутствующей — владелец не знал, что она вообще есть (02.10.2026). Прежний
 * довод «зелёное всё-закрыто висело бы над сеткой сорок недель в году» отменён:
 * цена спокойной недели — одна тихая зелёная строка, и она дешевле незамеченной
 * дыры. Ту же плашку рисует мини-апп (`ShortfallBanner`).
 *
 * Виды без нормы — в той же строке ссылкой-кнопкой в конце, а не отдельным предупреждением:
 * это не поломка, а несделанная настройка, и кричать о ней наравне с дырой
 * в графике значило бы приучить глаз строку пропускать.
 */
export function WeekShortfallBar({ shifts, templates, weekDates, pointedDate, calendar, onPointDay, onOpenKinds, nearestDate = null, onJumpNearest }: WeekShortfallBarProps) {
  const week = weekShortfall(shifts, templates, weekDates, calendar);
  const { days, total, withoutNorm } = week;
  const status = shortfallStatus(week, templates);
  // Число в сайдбаре считает сегодня…+6 и пересекает границу недели, а плашка видит
  // только показанную: без этой строки красное число вело к зелёному «Нормы закрыты ✓».
  const nearestOutside = nearestDate && !weekDates.includes(nearestDate) ? nearestDate : null;
  return (
    <div className={`week-shortfall week-shortfall--${status.state}`} data-shortfall={status.state} role="status">
      {status.state === "short" && <span className="week-shortfall-total">{`Не хватает ${total}`}</span>}
      {status.state === "closed" && <span className="week-shortfall-total">Нормы закрыты ✓</span>}
      {status.state === "no-norms" && <span className="week-shortfall-total">Нормы не заданы</span>}
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
          {` ${dayShortfallText(day.missing)}`}
        </button>
      ))}
      {status.state !== "no-norms" && nearestOutside && (
        <button
          type="button"
          className="week-shortfall-nearest btn btn-compact btn-quiet"
          onClick={() => onJumpNearest?.(nearestOutside)}
        >
          {nearestShortfallLabel(nearestOutside)}
        </button>
      )}
      {(withoutNorm.length > 0 || status.state === "no-norms") && (
        <button
          type="button"
          // «задать →» при незаданных нормах вовсе — настоящая кнопка: серой ссылкой её не замечали.
          className={`week-shortfall-unset btn btn-compact ${status.state === "no-norms" ? "btn-secondary" : "btn-quiet"}`}
          title={withoutNorm.length > 0 ? `Норма не задана: ${withoutNorm.map((kind) => kind.name).join(", ")}` : undefined}
          onClick={onOpenKinds}
        >
          {status.state === "no-norms"
            ? "задать →"
            : `без нормы: ${withoutNorm.length} ${pluralizeRu(withoutNorm.length, "вид", "вида", "видов")} →`}
        </button>
      )}
    </div>
  );
}
