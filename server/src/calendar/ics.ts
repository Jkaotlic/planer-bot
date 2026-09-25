import { shiftStartMs, nextDate } from "@planer/shared";

/** Одна запись в личной подписке — уже вынутая из строки `shifts`, без ссылок на БД. */
export interface IcsEntry {
  id: number;
  date: string;
  endDate: string | null;
  start: string | null;
  end: string | null;
  summary: string;
  location: string | null;
  updatedAtMs: number;
}

export interface BuildIcsOptions {
  /** Часовой пояс команды — из него время смены пересчитывается в UTC. */
  tz: string;
  /** Момент выдачи файла — идёт в DTSTAMP каждого события. */
  nowMs: number;
  /** Заголовок подписки в приложениях календаря (X-WR-CALNAME). */
  calName: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** UTC-момент как `YYYYMMDDTHHMMSSZ`. Без VTIMEZONE — календарь телефона сам
 *  переведёт в местное время, а лишний VTIMEZONE — лишнее место ошибиться. */
function formatUtc(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** `YYYY-MM-DD` → `YYYYMMDD`, для `VALUE=DATE` у событий на весь день. */
function formatDateOnly(date: string): string {
  return date.replaceAll("-", "");
}

/**
 * Экранирование текстовых полей по RFC 5545.
 *
 * Переносы строк нормализуются в `\n` первым делом: `location`/`note` часто
 * приходят из формы, набранной на Windows (`\r\n`), а голый `\r` в теле
 * property RFC 5545 не разрешает — не нормализовав его, мы вписали бы в файл
 * управляющий символ, который не экранируется ничем из идущего дальше.
 * Обратный слэш экранируется следующим, до всего остального: слэш, который
 * вставит экранирование переноса строки, иначе тут же удвоился бы сам.
 */
function escapeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * Свёртка строки по RFC 5545: не длиннее 75 октетов на физическую строку,
 * продолжение начинается с одного пробела (и потому съедает октет из лимита
 * следующей строки). Режется по символам (`Array.from`, не по code units),
 * чтобы не рассечь двухбайтовую кириллицу пополам — сломанный октет посреди
 * буквы календарь телефона не соберёт обратно.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  let limit = 75;
  for (const ch of Array.from(line)) {
    const chBytes = encoder.encode(ch).length;
    if (currentBytes + chBytes > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
      limit = 74; // следующая строка начнётся с пробела — он тоже октет
    }
    current += ch;
    currentBytes += chBytes;
  }
  if (current) parts.push(current);

  return parts.map((part, i) => (i === 0 ? part : ` ${part}`)).join("\r\n");
}

function buildEvent(entry: IcsEntry, opts: BuildIcsOptions): string[] {
  const lines: string[] = ["BEGIN:VEVENT", `UID:shift-${entry.id}@planer`, `DTSTAMP:${formatUtc(opts.nowMs)}`];

  // `endDate` игнорируется в этой ветке, и запись без `end` не получает
  // `DTEND` вовсе — оба намеренно, не пропуск. Категории, у которых бывает
  // `start` (`countsForBalance`), обязаны иметь и `end` (`entryTimesError`
  // в entry-schema.ts), а диапазоном (`endDate !== date`) по той же схеме
  // пишутся только отсутствия без времени (`entrySpanError`) — значит
  // «со временем» и «на несколько дней» в этих данных не пересекаются.
  // Если когда-нибудь появится путь в обход схемы (импорт, ручная правка
  // базы), эта функция тихо промолчит про второй день и про открытый конец,
  // а не подставит что-то на угад.
  if (entry.start) {
    const startMs = shiftStartMs({ date: entry.date, start: entry.start }, opts.tz);
    lines.push(`DTSTART:${formatUtc(startMs)}`);
    if (entry.end) {
      // Конец раньше начала по времени суток — ночная смена, конец на следующий
      // день. То же правило, каким остальной код читает пару (date, start, end)
      // — см. shared/src/handover.ts.
      const endDate = entry.end < entry.start ? nextDate(entry.date) : entry.date;
      const endMs = shiftStartMs({ date: endDate, start: entry.end }, opts.tz);
      lines.push(`DTEND:${formatUtc(endMs)}`);
    }
  } else {
    lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(entry.date)}`);
    const lastDay = entry.endDate ?? entry.date;
    lines.push(`DTEND;VALUE=DATE:${formatDateOnly(nextDate(lastDay))}`);
  }

  lines.push(`SUMMARY:${escapeText(entry.summary)}`);
  if (entry.location) lines.push(`LOCATION:${escapeText(entry.location)}`);
  lines.push(`LAST-MODIFIED:${formatUtc(entry.updatedAtMs)}`);
  lines.push("END:VEVENT");
  return lines;
}

/**
 * Личная подписка целиком, как текст .ics.
 *
 * Будильников (`VALARM`) нет намеренно: подписанные календари их обычно режут
 * (так делает iOS по умолчанию), так что вставленный будильник был бы кодом,
 * который никогда не сработает, — человек ставит своё оповещение сам, уже в
 * своём календаре.
 */
export function buildIcs(entries: IcsEntry[], opts: BuildIcsOptions): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//planer-bot//calendar//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.calName)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const entry of entries) lines.push(...buildEvent(entry, opts));
  lines.push("END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}
