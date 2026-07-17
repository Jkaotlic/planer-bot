import { resolveShiftTimes, nextDate, type EntryCategory } from "@planer/shared";
import type { Shift, ShiftTemplate } from "../db/schema";

export type RosterCell = { date: string; code: string };
export type ParsedRoster = { dates: string[]; people: { name: string; cells: RosterCell[] }[] };

/** "дд.мм.гггг" -> "YYYY-MM-DD". Throws on anything else. */
function parseRuDate(s: string): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim());
  if (!m) throw new Error(`плохая дата в шапке ростера: "${s}"`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function parseRosterCsv(text: string): ParsedRoster {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("пустой файл ростера");
  const header = lines[0].split(";");
  const dates = header.slice(1).map(parseRuDate); // header[0] is the empty name column
  const people = lines.slice(1).map((line) => {
    const fields = line.split(";");
    return {
      name: fields[0].trim(),
      cells: dates.map((date, i) => ({ date, code: (fields[i + 1] ?? "").trim() })),
    };
  });
  return { dates, people };
}

export const NON_WORKING_CODE = "holiday";

/** Work code -> preset NAME (ids are stable by name across live/fresh DBs). */
export const CODE_TO_PRESET_NAME: Record<string, string> = {
  "k32": "День",
  "k32-7": "Открытие",
  "k32-8": "Утро",
  "k32-11": "Вечер",
  "k32-15": "Ночь",
  "dezh": "Дежурство · Телефон",
  "pokl": "Дежурство · Поклонка",
  "v19": "Дежурство · Вавилова 19",
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
};
export type UnknownCell = { name: string; date: string; code: string };
export type DecodeResult = {
  perPerson: { name: string; entries: DecodedEntry[] }[];
  unknowns: UnknownCell[];
  proposedHolidays: string[];
};

export function decodeRoster(parsed: ParsedRoster, templates: ShiftTemplate[]): DecodeResult {
  const byName = new Map(templates.map((t) => [t.name, t] as const));
  const unknowns: UnknownCell[] = [];
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

      const absence = CODE_TO_ABSENCE[code];
      if (absence) {
        if (run && run.code === code) run.to = cell.date;
        else { flush(); run = { category: absence, code, from: cell.date, to: cell.date }; }
        continue;
      }

      flush();
      const preset = byName.get(CODE_TO_PRESET_NAME[code] ?? "");
      if (!preset) { unknowns.push({ name: p.name, date: cell.date, code }); continue; }
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
  return { perPerson, unknowns, proposedHolidays };
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

/** One entry -> its roster code. Preset wins; else absence category; else non-working. */
export function encodeEntryCode(shift: Pick<Shift, "category" | "templateId">, templatesById: Map<number, { name: string }>): string {
  if (shift.templateId != null) {
    const name = templatesById.get(shift.templateId)?.name;
    const code = name ? PRESET_NAME_TO_CODE[name] : undefined;
    if (code) return code;
  }
  return ABSENCE_CATEGORY_TO_CODE[shift.category] ?? NON_WORKING_CODE;
}

export function serializeRosterCsv(dates: string[], rows: { name: string; codes: string[] }[]): string {
  const header = ["", ...dates.map(toRuDate)].join(";");
  const lines = rows.map((r) => [rosterField(r.name), ...r.codes].join(";"));
  return [header, ...lines].join("\r\n");
}
