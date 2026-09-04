import type { Db } from "../db/client";
import { listCalendarYear, replaceAutoYear } from "../repo/calendar-days";
import {
  holidaysCheckedOn,
  holidaysState,
  isHolidaysAuto,
  markHolidaysChecked,
  setHolidayYearState,
} from "../repo/settings";
import { recordAudit } from "../repo/audit";
import { BUNDLED_YEARS } from "./bundled";
import { parseXmlCalendar, type CalendarYear, type FetchYear } from "./xmlcalendar";

/**
 * Данным старше этого тик не верит и перечитывает.
 *
 * Не украшение: переносы правят и в течение года — постановление о переносе
 * выходит отдельным документом, и календарь на сайте меняется задним числом.
 */
export const HOLIDAYS_STALE_DAYS = 30;

export type YearRefresh = {
  year: number;
  status: "ok" | "missing" | "error" | "bundled";
  added: number;
  removed: number;
  message?: string;
};

/** В `calendar_days` едут только исключения; сокращённый день — отдельный заход. */
function storable(year: CalendarYear) {
  return year.days.flatMap((day) =>
    day.kind === "short" ? [] : [{ date: day.date, kind: day.kind, note: day.note }],
  );
}

/**
 * Общий код тика и кнопки «Обновить сейчас».
 *
 * `missing` — не провал: календарь на следующий год Правительство утверждает
 * осенью, и до тех пор источник честно отвечает 404. `error` при ПУСТОМ годе
 * закрывается зашитой копией — иначе первый запуск без сети оставил бы команду
 * без праздников; при непустом не трогается ничего: несвежие данные лучше
 * стёртых.
 *
 * Провал пишет в журнал только кнопка (`actor` не пуст): тик повторит завтра
 * сам, и строка каждый день была бы шумом в ленте.
 */
export async function refreshHolidays(
  db: Db,
  fetchYear: FetchYear,
  years: readonly number[],
  actor: number | null,
  now: Date,
): Promise<YearRefresh[]> {
  const out: YearRefresh[] = [];
  for (const year of years) {
    const outcome = await fetchYear(year);
    if (outcome.status === "missing") {
      out.push({ year, status: "missing", added: 0, removed: 0 });
      continue;
    }
    if (outcome.status === "error") {
      out.push(failed(db, year, outcome.message, actor, now));
      continue;
    }
    let parsed: CalendarYear;
    try {
      parsed = parseXmlCalendar(outcome.xml);
    } catch (err) {
      // Страница ошибки с кодом 200 — обычное дело у любого сайта, и разобрать
      // её как пустой год значило бы стереть настоящие праздники.
      out.push(failed(db, year, err instanceof Error ? err.message : String(err), actor, now));
      continue;
    }
    const days = storable(parsed);
    const { added, removed } = replaceAutoYear(db, year, days, now);
    setHolidayYearState(db, year, { refreshedAt: now.toISOString(), source: "xmlcalendar", days: days.length });
    recordAudit(db, "holidays_refreshed", actor, { year, added, removed, source: "xmlcalendar" });
    out.push({ year, status: "ok", added, removed });
  }
  return out;
}

function failed(db: Db, year: number, message: string, actor: number | null, now: Date): YearRefresh {
  if (actor != null) recordAudit(db, "holidays_refresh_failed", actor, { year, message });
  const bundled = BUNDLED_YEARS[year];
  if (bundled && listCalendarYear(db, year).length === 0) {
    const days = storable(bundled);
    const { added, removed } = replaceAutoYear(db, year, days, now);
    setHolidayYearState(db, year, { refreshedAt: now.toISOString(), source: "bundled", days: days.length });
    recordAudit(db, "holidays_refreshed", actor, { year, added, removed, source: "bundled" });
    return { year, status: "bundled", added, removed, message };
  }
  console.error(`holidays: year ${year} not refreshed: ${message}`);
  return { year, status: "error", added: 0, removed: 0, message };
}

/**
 * Раз в сутки: текущий и следующий год, и только если их нет или они залежались.
 *
 * Отметка о проверке ставится ДО загрузки и независимо от её исхода: тик
 * крутится каждые пять минут, и упавшая сеть не должна обернуться сотней
 * запросов за вечер. Повтор — завтра.
 */
export async function runHolidayTick(db: Db, fetchYear: FetchYear, now: { date: string }): Promise<number> {
  if (!isHolidaysAuto(db)) return 0;
  if (holidaysCheckedOn(db) === now.date) return 0;
  markHolidaysChecked(db, now.date);

  const state = holidaysState(db);
  const today = Date.parse(`${now.date}T00:00:00Z`);
  const stale = (year: number) => {
    const known = state[String(year)];
    if (!known || listCalendarYear(db, year).length === 0) return true;
    return Date.parse(known.refreshedAt) < today - HOLIDAYS_STALE_DAYS * 86_400_000;
  };

  const year = Number(now.date.slice(0, 4));
  const years = [year, year + 1].filter(stale);
  if (years.length === 0) return 0;
  const report = await refreshHolidays(db, fetchYear, years, null, new Date(`${now.date}T12:00:00Z`));
  return report.filter((r) => r.status === "ok" || r.status === "bundled").length;
}
