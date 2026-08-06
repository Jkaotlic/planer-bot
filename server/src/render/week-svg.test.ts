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
