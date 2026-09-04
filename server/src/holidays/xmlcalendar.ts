import { formatDayMonth, type DayKind } from "@planer/shared";

/**
 * Производственный календарь с xmlcalendar.ru.
 *
 * У Минтруда машиночитаемого источника нет: постановления Правительства о
 * переносах выходят документами, а xmlcalendar собирает их в XML с 2013 года.
 * В `<days>` лежат только исключения: `t="1"` — праздник или перенесённый
 * выходной (`h` — название, `f` — откуда перенесли), `t="2"` — сокращённый
 * рабочий день, `t="3"` — рабочая суббота или воскресенье. Обычных суббот там
 * нет, и это ровно та форма, в которой живёт `calendar_days`.
 *
 * Регулярки, а не XML-библиотека: формат плоский, три атрибута на строку, и
 * зависимость ради него была бы дороже, чем эти двадцать строк.
 */
export const XMLCALENDAR_URL = "https://xmlcalendar.ru/data/ru";

export interface CalendarDayFromSource {
  date: string;
  /** `short` — сокращённый предпраздничный день; в `calendar_days` он не едет. */
  kind: DayKind | "short";
  note: string | null;
}

export interface CalendarYear {
  year: number;
  days: CalendarDayFromSource[];
}

export function parseXmlCalendar(xml: string): CalendarYear {
  const yearMatch = /<calendar\b[^>]*\byear="(\d{4})"/.exec(xml);
  // Сайт, отвечающий страницей ошибки с кодом 200, — обычное дело, и молча
  // положить такой «год» значило бы стереть настоящие праздники пустотой.
  if (!yearMatch) throw new Error("Ответ источника не похоже на календарь: нет <calendar year=…>");
  const year = Number(yearMatch[1]);

  const titles = new Map<string, string>();
  for (const m of xml.matchAll(/<holiday\b[^>]*\bid="(\d+)"[^>]*\btitle="([^"]*)"/g)) titles.set(m[1]!, m[2]!);

  const days: CalendarDayFromSource[] = [];
  for (const m of xml.matchAll(/<day\b([^>]*?)\/>/g)) {
    const attrs = Object.fromEntries(
      [...m[1]!.matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!]),
    ) as Record<string, string>;
    const d = attrs.d;
    if (!d || !/^\d{2}\.\d{2}$/.test(d)) continue;
    const date = `${year}-${d.slice(0, 2)}-${d.slice(3, 5)}`;
    if (attrs.t === "1") {
      const from = attrs.f ? `${year}-${attrs.f.slice(0, 2)}-${attrs.f.slice(3, 5)}` : null;
      const note = (attrs.h ? titles.get(attrs.h) : undefined) ?? (from ? `Выходной по переносу с ${formatDayMonth(from)}` : null);
      days.push({ date, kind: "holiday", note });
    } else if (attrs.t === "2") {
      days.push({ date, kind: "short", note: null });
    } else if (attrs.t === "3") {
      days.push({ date, kind: "workday", note: "Рабочий день по переносу" });
    }
    // Иной тип — новинка формата; пропустить один день лучше, чем потерять год.
  }
  return { year, days };
}

export type FetchOutcome = { status: "ok"; xml: string } | { status: "missing" } | { status: "error"; message: string };
export type FetchYear = (year: number) => Promise<FetchOutcome>;

/**
 * Загрузчик года.
 *
 * 404 — «год ещё не опубликован», и это не ошибка: календарь на следующий год
 * Правительство утверждает осенью. Всё остальное — ошибка, которую стоит
 * повторить завтра. Таймаут короткий: тик делит процесс с long-polling бота.
 */
export function xmlcalendarFetcher(fetchImpl: typeof fetch = fetch, timeoutMs = 10_000): FetchYear {
  return async (year) => {
    try {
      const res = await fetchImpl(`${XMLCALENDAR_URL}/${year}/calendar.xml`, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 404) return { status: "missing" };
      if (!res.ok) return { status: "error", message: `HTTP ${res.status}` };
      return { status: "ok", xml: await res.text() };
    } catch (err) {
      return { status: "error", message: err instanceof Error ? err.message : String(err) };
    }
  };
}
