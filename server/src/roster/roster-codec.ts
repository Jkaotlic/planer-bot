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
