import { resolveShiftTimes, nextDate, type EntryCategory } from "@planer/shared";
import type { Shift, ShiftTemplate } from "../db/schema";

export type RosterCell = { date: string; code: string };
export type ParsedRoster = { dates: string[]; people: { name: string; cells: RosterCell[] }[] };

/** "дд.мм.гггг" -> "YYYY-MM-DD". Throws on anything else. */
function parseRuDate(s: string): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim());
  if (!m) throw new Error(`плохая дата в шапке ростера: "${s}"`);
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`плохая дата в шапке ростера: "${s}"`);
  }
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Splits one semicolon-delimited roster row, including Excel-style quoted fields. */
function parseRosterLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!;
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ";" && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("незакрытая кавычка в CSV ростера");
  fields.push(field);
  return fields;
}

/**
 * The header must be one unbroken run of days, ascending — the shape the export
 * always writes.
 *
 * The import trusts that header twice over. The span it governs is first..last,
 * and every cell is filed under its own column, so each way of breaking the run
 * costs data silently: a duplicated column imports that day twice; a moved one
 * turns the span inside out, so the «this period already holds entries» guard
 * matches nothing and the month lands a second time on top of itself; a deleted
 * one leaves a day *inside* the span that the file never describes, which an
 * overwrite then wipes. In Excel all three are one drag, and none of them look
 * wrong in the grid afterwards — which is the same reason a ragged row is
 * refused above rather than padded.
 */
function assertConsecutive(dates: string[]): void {
  for (let i = 1; i < dates.length; i++) {
    const expected = nextDate(dates[i - 1]!);
    if (dates[i] !== expected) {
      throw new Error(
        `шапка ростера: после ${toRuDate(dates[i - 1]!)} идёт ${toRuDate(dates[i]!)}, ` +
          `а должно быть ${toRuDate(expected)} — колонка продублирована, переставлена или удалена`,
      );
    }
  }
}

export function parseRosterCsv(text: string): ParsedRoster {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("пустой файл ростера");
  const header = parseRosterLine(lines[0]);
  const dates = header.slice(1).map(parseRuDate); // header[0] is the empty name column
  assertConsecutive(dates);
  const people = lines.slice(1).map((line, index) => {
    const fields = parseRosterLine(line);
    const name = fields[0].trim();
    // A ragged row is never harmless: padding a short one out writes "не работает"
    // onto days the file never described, and a long one silently drops its tail.
    // Excel always emits full-width rows, so a mismatch means the file was edited by
    // hand — say which row, counted the way the admin sees it in the spreadsheet.
    if (fields.length - 1 !== dates.length) {
      throw new Error(
        `строка ${index + 2}${name ? ` («${name}»)` : ""}: ${fields.length - 1} клеток, а в шапке ${dates.length} дат`,
      );
    }
    return {
      name,
      cells: dates.map((date, i) => ({ date, code: (fields[i + 1] ?? "").trim() })),
    };
  });
  return { dates, people };
}

export const NON_WORKING_CODE = "holiday";
/** A covering entry the roster vocabulary can't express (e.g. weekend_work, or a
 *  timed entry with no preset). Never means "not working". */
export const UNENCODABLE_CODE = "?";

/** Work code -> preset NAME (ids are stable by name across live/fresh DBs). */
export const CODE_TO_PRESET_NAME: Record<string, string> = {
  "k32": "День",
  "k32-7": "Дежурство с 07:00",
  "k32-8": "Утро",
  "k32-11": "Вечер",
  "k32-15": "Ночь",
  "dezh": "Дежурство · Телефон",
  "pokl": "Дежурство · Поклонка",
  "v19": "Дежурство · Вавилова 19",
  // Резервный дежурный. In the August file it only ever lands on a Saturday or a
  // Sunday, always beside exactly one person on `k32` — one works, one or two
  // stand by. It is a work code, so a day that has only reserves on it is still
  // not proposed as a holiday.
  "rezerv": "Дежурство · Резерв",
};
/** Absence code -> category (stored as a date range, no times). */
export const CODE_TO_ABSENCE: Record<string, EntryCategory> = {
  "otp": "vacation",
  "event": "business_trip",
};
export const PRESET_NAME_TO_CODE: Record<string, string> =
  Object.fromEntries(Object.entries(CODE_TO_PRESET_NAME).map(([code, name]) => [name, code]));
export const ABSENCE_CATEGORY_TO_CODE: Partial<Record<EntryCategory, string>> =
  Object.fromEntries(Object.entries(CODE_TO_ABSENCE).map(([code, cat]) => [cat, code]));

export type DecodedEntry = {
  date: string;
  endDate: string | null;
  category: EntryCategory;
  templateId: number | null;
  location: string | null;
  start: string | null;
  end: string | null;
  title: string | null;
  /** Set only for a cell we could not read: the raw text, kept verbatim. Such an
   *  entry is the one work entry with no clock times — inventing hours for
   *  something we did not understand would be a lie. */
  unrecognisedCode?: string | null;
};
export type UnknownCell = { name: string; date: string; code: string };
/** A cell the export wrote as '?': something covers that day which the roster
 *  vocabulary can't express. On import it means "leave whatever is there alone". */
export type PreservedCell = { name: string; date: string };
export type DecodeResult = {
  perPerson: { name: string; entries: DecodedEntry[] }[];
  unknowns: UnknownCell[];
  preserved: PreservedCell[];
  proposedHolidays: string[];
};

export function decodeRoster(parsed: ParsedRoster, templates: ShiftTemplate[]): DecodeResult {
  const byName = new Map(templates.map((t) => [t.name, t] as const));
  const unknowns: UnknownCell[] = [];
  const preserved: PreservedCell[] = [];
  const workersByDate = new Map<string, number>(); // count of WORK-code cells per date

  const perPerson = parsed.people.map((p) => {
    const entries: DecodedEntry[] = [];
    let run: { category: EntryCategory; code: string; from: string; to: string } | null = null;
    const flush = () => {
      if (!run) return;
      entries.push({
        date: run.from, endDate: run.to === run.from ? null : run.to,
        category: run.category, templateId: null, location: null, start: null, end: null, title: null,
      });
      run = null;
    };

    for (const cell of p.cells) {
      const code = cell.code;
      if (code === NON_WORKING_CODE || code === "") { flush(); continue; }

      // '?' is our own export marker for an entry the vocabulary can't express
      // (weekend work, a one-off custom time). Re-importing that file must leave
      // the existing entry alone rather than refusing the whole file — but the day
      // still counts as worked, so it is never mistaken for a holiday.
      if (code === UNENCODABLE_CODE) {
        flush();
        preserved.push({ name: p.name, date: cell.date });
        workersByDate.set(cell.date, (workersByDate.get(cell.date) ?? 0) + 1);
        continue;
      }

      // Object.hasOwn guards against a cell literally reading "constructor" / "toString" /
      // etc. — a plain-object lookup would resolve those to inherited Object.prototype
      // members instead of undefined, and blow up downstream instead of being unknown.
      const absence = Object.hasOwn(CODE_TO_ABSENCE, code) ? CODE_TO_ABSENCE[code] : undefined;
      if (absence) {
        if (run && run.code === code) run.to = cell.date;
        else { flush(); run = { category: absence, code, from: cell.date, to: cell.date }; }
        continue;
      }

      flush();
      const presetName = Object.hasOwn(CODE_TO_PRESET_NAME, code) ? CODE_TO_PRESET_NAME[code] : undefined;
      const preset = byName.get(presetName ?? "");
      if (!preset) {
        // A cell we cannot read no longer sinks the whole file. It is reported so
        // the admin is told exactly where it is, AND kept as an entry marked «?»:
        // dropping it would quietly turn somebody's working day into a day off,
        // which is the more expensive mistake of the two.
        unknowns.push({ name: p.name, date: cell.date, code });
        entries.push({
          date: cell.date, endDate: null, category: "shift", templateId: null,
          location: null, start: null, end: null, title: null, unrecognisedCode: code,
        });
        // Somebody is down for that day, so it is not a company holiday.
        workersByDate.set(cell.date, (workersByDate.get(cell.date) ?? 0) + 1);
        continue;
      }
      const { start, end } = resolveShiftTimes(preset, cell.date);
      entries.push({
        date: cell.date, endDate: null, category: preset.category, templateId: preset.id,
        location: preset.location, start, end, title: preset.name,
      });
      workersByDate.set(cell.date, (workersByDate.get(cell.date) ?? 0) + 1);
    }
    flush();
    return { name: p.name, entries };
  });

  // A day is non-working iff nobody has a work code on it (§5). Absences don't count as work.
  const proposedHolidays = parsed.dates.filter((d) => (workersByDate.get(d) ?? 0) === 0);
  return { perPerson, unknowns, preserved, proposedHolidays };
}

export function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = nextDate(d)) out.push(d);
  return out;
}

/** "YYYY-MM-DD" -> "дд.мм.гггг" for the export header. */
function toRuDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function rosterField(v: string): string {
  return /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** One entry -> its roster code. An unread cell wins over everything (it keeps the
 *  original text), then the preset, then the absence category, else non-working. */
export function encodeEntryCode(
  shift: Pick<Shift, "category" | "templateId"> & { unrecognisedCode?: string | null },
  templatesById: Map<number, { name: string }>,
): string {
  // Write back exactly what the file said. The export is what the admin edits and
  // re-uploads, so replacing «Ко» with anything else would either lose the cell or
  // silently invent a shift nobody rostered.
  if (shift.unrecognisedCode) return shift.unrecognisedCode;
  if (shift.templateId != null) {
    const name = templatesById.get(shift.templateId)?.name;
    const code = name ? PRESET_NAME_TO_CODE[name] : undefined;
    if (code) return code;
  }
  return ABSENCE_CATEGORY_TO_CODE[shift.category] ?? UNENCODABLE_CODE;
}

export function serializeRosterCsv(dates: string[], rows: { name: string; codes: string[] }[]): string {
  const header = ["", ...dates.map(toRuDate)].join(";");
  const lines = rows.map((r) => [rosterField(r.name), ...r.codes].join(";"));
  return [header, ...lines].join("\r\n");
}
