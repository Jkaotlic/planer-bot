import { describe, it, expect } from "vitest";
import { buildWeekLegend, buildWeekModel, type ScheduleEntryLike, type SchedulePresetLike } from "@planer/shared";
import { escapeXml, renderWeekSvg } from "./week-svg";

const MONDAY = "2026-08-03";

const PRESETS: SchedulePresetLike[] = [
  { id: 1, name: "День", accent: "blue", sortOrder: 1 },
  { id: 2, name: "Ночь", accent: "indigo", sortOrder: 2 },
];

function entry(over: Partial<ScheduleEntryLike> & { date: string }): ScheduleEntryLike {
  return {
    employeeId: 1, endDate: null, start: "08:00", end: "20:00",
    category: "shift", title: null, templateId: 1, unrecognisedCode: null,
    ...over,
  };
}

function svgFor(
  employees: { id: number; displayName: string; rosterOrder: number | null }[],
  shifts: ScheduleEntryLike[],
  today = "2026-08-05",
): string {
  const model = buildWeekModel(MONDAY, { employees, shifts }, PRESETS);
  return renderWeekSvg({ model, legend: buildWeekLegend(model), weekLabel: "Команда · 3–9 августа", today });
}

const TEAM = [
  { id: 1, displayName: "Иванов Иван", rosterOrder: 0 },
  { id: 2, displayName: "Петров Пётр", rosterOrder: 1 },
];

// The name column's geometry, copied from week-svg.ts: usable width, the widest
// character each of the two sizes is budgeted at, and the gap between them.
// What the tests below assert is that whatever is drawn still fits this box —
// the two halves of the name spend one budget, not one each.
const NAME_COL_W = 244 - 16;
const SURNAME_CHAR_W = 15;
const GIVEN_CHAR_W = 11;
const NAME_GAP = 8;

/**
 * Every row label as it is actually drawn: the surname, and the given name that
 * shares the very same `<text>` with it — empty when there was no room for it.
 * Sharing one element is the guarantee: the renderer, not our arithmetic, puts
 * the given name behind the surname, so the two cannot land on one another.
 */
function nameCells(svg: string): { surname: string; given: string }[] {
  return [...svg.matchAll(/<text x="24" y="\d+">(.*?)<\/text>/g)].map((row) => {
    const spans = [...row[1]!.matchAll(/<tspan[^>]*>(.*?)<\/tspan>/g)].map((span) => span[1]!);
    return { surname: spans[0] ?? "", given: spans[1] ?? "" };
  });
}

/** Width the label is budgeted at — must never exceed the column. */
function nameWidth(cell: { surname: string; given: string }): number {
  return cell.surname.length * SURNAME_CHAR_W
    + (cell.given ? NAME_GAP + cell.given.length * GIVEN_CHAR_W : 0);
}

describe("renderWeekSvg", () => {
  it("возвращает корректный SVG заданной ширины", () => {
    const svg = svgFor(TEAM, []);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('width="1200"');
  });

  it("пишет заголовок и все семь дней", () => {
    const svg = svgFor(TEAM, []);
    expect(svg).toContain("Команда · 3–9 августа");
    for (const day of ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]) {
      expect(svg, day).toContain(`>${day}<`);
    }
  });

  it("рисует по строке на человека", () => {
    const svg = svgFor(TEAM, []);
    expect(svg).toContain("Иванов");
    expect(svg).toContain("Петров");
  });

  it("заливает клетку цветом пресета и подписывает его буквой", () => {
    const svg = svgFor(TEAM, [entry({ date: "2026-08-05" })]);
    expect(svg).toContain('fill="#EAF0F0"'); // blue slot of the shift palette
    expect(svg).toContain(">Д<");
  });

  it("показывает +N, когда в клетке больше одной записи", () => {
    const svg = svgFor(TEAM, [
      entry({ date: "2026-08-03" }),
      entry({ date: "2026-08-03", templateId: 2, start: "20:00", end: "08:00" }),
    ]);
    expect(svg).toContain(">+1<");
  });

  it("обрезает длинную фамилию, а не выпускает её за колонку", () => {
    const longSurname = [{ id: 1, displayName: "Мегадлиннофамильев Иван", rosterOrder: 0 }];
    const svg = svgFor(longSurname, []);
    expect(svg).not.toContain("Мегадлиннофамильев");
    expect(svg).toContain("…");
    // The clipping above says nothing about where the pieces landed. A surname
    // this long spends the whole column, so the given name is not drawn at all:
    // the old layout still drew it, anchored to the column's right edge, and it
    // came out on top of the clipped surname — both "within their limit".
    expect(nameCells(svg)).toEqual([{ surname: "Мегадлиннофами…", given: "" }]);
    expect(svg).not.toContain("Иван");
  });

  it("фамилия и имя делят один бюджет колонки, а не по своему на каждого", () => {
    // The same given name after surnames of growing length: it gets whatever
    // the surname left, and nothing once the surname has taken the column.
    const cells = ["Ким", "Сидоренко", "Христорождественский"].map(
      (surname) => nameCells(svgFor([{ id: 1, displayName: `${surname} Иннокентий`, rosterOrder: 0 }], []))[0]!,
    );
    expect(cells.map((cell) => cell.given)).toEqual(["Иннокентий", "Инноке…", ""]);
    for (const cell of cells) {
      expect(nameWidth(cell), `${cell.surname} ${cell.given}`).toBeLessThanOrEqual(NAME_COL_W);
    }
  });

  it("«Не назначено» — это не фамилия с именем, и рисуется одним стилем", () => {
    const svg = svgFor(TEAM, [entry({ date: "2026-08-05", employeeId: null })]);
    expect(nameCells(svg).at(-1)).toEqual({ surname: "Не назначено", given: "" });
    // Split like a name it renders as a bold «Не» beside a muted «назначено» —
    // in a PNG that reads as a bug, not as a row label.
    expect(svg).not.toContain(">Не</tspan>");
  });

  it("обводит сегодняшнюю колонку и только когда сегодня внутри недели", () => {
    expect(svgFor(TEAM, [], "2026-08-05")).toContain('stroke="#2F80ED"');
    expect(svgFor(TEAM, [], "2026-09-01")).not.toContain('stroke="#2F80ED"');
  });

  it("пустая неделя рисует сетку и говорит, что записей нет", () => {
    const svg = svgFor(TEAM, []);
    expect(svg).toContain("Иванов");
    expect(svg).toContain("На этой неделе записей нет");
    expect(svg).not.toContain("Что значат буквы");
  });

  it("непустая неделя объясняет буквы", () => {
    const svg = svgFor(TEAM, [entry({ date: "2026-08-05" })]);
    expect(svg).toContain("Что значат буквы");
    expect(svg).toContain("День");
  });

  it("экранирует спецсимволы в именах — иначе одна фамилия ломает документ", () => {
    const unsafeName = [{ id: 1, displayName: "Иванов&Ко <b>", rosterOrder: 0 }];
    const svg = svgFor(unsafeName, []);
    expect(svg).toContain("Иванов&amp;Ко");
    expect(svg).not.toContain("Иванов&Ко");
  });

  it("escapeXml закрывает все пять спецсимволов", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });

  it("escapeXml вырезает управляющие символы C0, но не трогает разрешённые", () => {
    // XML forbids them outright, so escaping wouldn't help: `&#1;` is just as
    // invalid as the raw byte. Tab, LF and CR are the three it does allow.
    expect(escapeXml("Ива\u0001нов\u001F")).toBe("Иванов");
    expect(escapeXml("\u0000\u0008\u000B\u000C\u000E")).toBe("");
    expect(escapeXml("а\tб\nв\r")).toBe("а\tб\nв\r");
  });

  it("управляющий символ в имени не убивает картинку целиком", () => {
    // One such byte — from a CSV exported out of Excel, say — used to make the
    // whole document unparsable: nobody in the team got a picture, and the
    // parser error named no row.
    const svg = svgFor([{ id: 1, displayName: "Ива\u0001нов Иван", rosterOrder: 0 }], []);
    expect(svg).toContain("Иванов");
    expect(svg).not.toContain("\u0001");
  });

  it("пустой ростер всё равно рисует валидный SVG", () => {
    const svg = svgFor([], []);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('width="1200"');
    for (const day of ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]) {
      expect(svg, day).toContain(`>${day}<`);
    }
    const height = Number(svg.match(/height="(\d+)"/)?.[1]);
    expect(height).toBeGreaterThan(0);
  });

  it("переносит легенду на вторую строку, когда пунктов больше двух", () => {
    const svg = svgFor(TEAM, [
      entry({ date: "2026-08-03", employeeId: 1, templateId: 1 }),
      entry({ date: "2026-08-04", employeeId: 1, templateId: 2, start: "20:00", end: "08:00" }),
      entry({ date: "2026-08-05", employeeId: 2, templateId: null, category: "vacation", start: null, end: null }),
    ]);
    const swatches = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="34" height="28"/g)];
    expect(swatches).toHaveLength(3);
    const [first, , third] = swatches;
    expect(third[1]).toBe(first[1]); // third item starts in the same column as the first
    expect(Number(third[2]) - Number(first[2])).toBe(40); // ...and exactly one legend row below it
  });
});
