import type { CalendarYear } from "./xmlcalendar";

/**
 * Запас на случай, когда источник недоступен, а праздников за год ещё нет.
 *
 * Снято с xmlcalendar.ru 2026-09-04; копия XML лежит рядом в `fixtures/`, и
 * `bundled.test.ts` сверяет литерал с её разбором — иначе эти двое разъедутся
 * молча. Берётся только когда таблица за год пуста: имеющиеся данные, пусть и
 * несвежие, лучше зашитых (`holiday-tick.ts`).
 *
 * Год здесь один. Следующий появится в репозитории тогда же, когда его
 * опубликует источник, — до тех пор запасать нечего.
 */
export const BUNDLED_YEARS: Readonly<Record<number, CalendarYear>> = {
  2026: {
    year: 2026,
    days: [
    { date: "2026-01-01", kind: "holiday", note: "Новогодние каникулы" },
    { date: "2026-01-02", kind: "holiday", note: "Новогодние каникулы" },
    { date: "2026-01-03", kind: "holiday", note: "Новогодние каникулы" },
    { date: "2026-01-04", kind: "holiday", note: "Новогодние каникулы" },
    { date: "2026-01-05", kind: "holiday", note: "Новогодние каникулы" },
    { date: "2026-01-06", kind: "holiday", note: "Новогодние каникулы" },
    { date: "2026-01-07", kind: "holiday", note: "Рождество Христово" },
    { date: "2026-01-08", kind: "holiday", note: "Новогодние каникулы" },
    { date: "2026-01-09", kind: "holiday", note: "Выходной по переносу с 3 января" },
    { date: "2026-02-23", kind: "holiday", note: "День защитника Отечества" },
    { date: "2026-03-08", kind: "holiday", note: "Международный женский день" },
    { date: "2026-03-09", kind: "holiday", note: "Выходной по переносу с 8 марта" },
    { date: "2026-04-30", kind: "short", note: null },
    { date: "2026-05-01", kind: "holiday", note: "Праздник Весны и Труда" },
    { date: "2026-05-08", kind: "short", note: null },
    { date: "2026-05-09", kind: "holiday", note: "День Победы" },
    { date: "2026-05-11", kind: "holiday", note: "Выходной по переносу с 9 мая" },
    { date: "2026-06-11", kind: "short", note: null },
    { date: "2026-06-12", kind: "holiday", note: "День России" },
    { date: "2026-11-03", kind: "short", note: null },
    { date: "2026-11-04", kind: "holiday", note: "День народного единства" },
    { date: "2026-12-31", kind: "holiday", note: "Выходной по переносу с 4 января" },
    ],
  },
};
