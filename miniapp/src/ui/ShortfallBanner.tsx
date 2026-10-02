import { dayShortfallText, weekdayShort, type ShortfallStatus, type WeekShortfall } from "@planer/shared";
import { pluralizeRu } from "../lib/shift";

/**
 * Плашка над графиком: закрыты ли нормы недели.
 *
 * Стоит всегда, а не только при нехватке: молчащая подсказка неотличима от
 * отсутствующей — владелец неделю не знал, что она вообще есть (02.10.2026).
 * Цена — зелёная строка в спокойные недели; она тоньше красной и без кнопок.
 */
export function ShortfallBanner({ week, status, onPickDay, onOpenNorms }: {
  week: WeekShortfall;
  status: ShortfallStatus;
  onPickDay: (date: string) => void;
  onOpenNorms: () => void;
}) {
  return (
    <div className={`ui-shortfall ui-shortfall--${status.state}`} data-shortfall={status.state} role="status">
      {status.state === "short" && (
        <>
          <span className="ui-shortfall-title">{`Не хватает ${week.total}`}</span>
          <span className="ui-shortfall-days">
            {week.days.map((day) => (
              <button key={day.date} type="button" className="ui-shortfall-day" data-shortfall-day={day.date} onClick={() => onPickDay(day.date)}>
                <b>{weekdayShort(day.date)}</b>
                {` ${dayShortfallText(day.missing)}`}
              </button>
            ))}
          </span>
        </>
      )}
      {status.state === "closed" && <span className="ui-shortfall-title">Нормы закрыты ✓</span>}
      {status.state === "no-norms" && (
        // Заголовок и кнопка в одной строке: «задать →» мелкой серой строкой под
        // заголовком читалась как подпись, а не как действие.
        <div className="ui-shortfall-row">
          <span className="ui-shortfall-title">Нормы не заданы</span>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--compact ui-shortfall-set" data-norm-unset onClick={onOpenNorms}>
            задать →
          </button>
        </div>
      )}
      {status.state !== "no-norms" && status.unsetCount > 0 && (
        <button type="button" className="ui-shortfall-unset" data-norm-unset onClick={onOpenNorms}>
          {`Без нормы: ${status.unsetCount} ${pluralizeRu(status.unsetCount, "вид", "вида", "видов")} — задать →`}
        </button>
      )}
    </div>
  );
}
