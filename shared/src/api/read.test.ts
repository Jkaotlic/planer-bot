import { describe, expect, it } from "vitest";
import { teamScheduleResponseSchema, templatesResponseSchema } from "./read";

describe("схемы домена read", () => {
  it("принимают ответ той формы, что сервер отдаёт сегодня", () => {
    const parsed = templatesResponseSchema.safeParse({
      templates: [
        {
          id: 1,
          name: "Утро",
          category: "shift",
          start: "08:00",
          end: "17:00",
          fridayStart: "08:00",
          fridayEnd: "16:00",
          location: null,
          accent: "yellow",
          isLate: false,
          sendReminder: true,
          sortOrder: 0,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("отвергают лишнее поле, а не молча его глотают", () => {
    // Без .strict() этот случай проходил бы всегда — то есть тест не мог бы упасть.
    const parsed = templatesResponseSchema.safeParse({
      templates: [
        {
          id: 1,
          name: "Утро",
          category: "shift",
          start: "08:00",
          end: "17:00",
          fridayStart: "08:00",
          fridayEnd: "16:00",
          location: null,
          accent: "yellow",
          isLate: false,
          sendReminder: true,
          sortOrder: 0,
          coverage: "0,0,0,0,0,0,0",
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("отвергают запись графика без обязательной даты", () => {
    const parsed = teamScheduleResponseSchema.safeParse({
      employees: [],
      shifts: [
        {
          id: 1,
          start: null,
          end: null,
          endDate: null,
          category: "shift",
          title: null,
          location: null,
          unrecognisedCode: null,
          templateId: null,
          employeeId: null,
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("«ждёт ОК» в записи графика", () => {
  it("«ждёт ОК» — необязательное `pending: true`; старый ответ без него проходит, `false` — нет", () => {
    const row = {
      id: 1, date: "2026-10-06", start: null, end: null, endDate: null, category: "sick_leave",
      title: null, location: null, unrecognisedCode: null, templateId: null, employeeId: 3,
    };
    const parse = (shift: object) => teamScheduleResponseSchema.safeParse({ employees: [], shifts: [shift], calendar: [] }).success;
    expect(parse(row)).toBe(true);
    expect(parse({ ...row, pending: true })).toBe(true);
    // Сервер шлёт ключ только у ждущего: `false` на каждой строке раздувал бы ответ без смысла.
    expect(parse({ ...row, pending: false })).toBe(false);
  });

  it("`approvedSpan` — необязательный подтверждённый срок продления; лишний ключ внутри отвергается", () => {
    const row = {
      id: 1, date: "2026-10-06", start: null, end: null, endDate: "2026-10-09", category: "sick_leave",
      title: null, location: null, unrecognisedCode: null, templateId: null, employeeId: 3, pending: true,
    };
    const parse = (shift: object) => teamScheduleResponseSchema.safeParse({ employees: [], shifts: [shift], calendar: [] }).success;
    expect(parse({ ...row, approvedSpan: { date: "2026-10-06", endDate: "2026-10-07" } })).toBe(true);
    expect(parse({ ...row, approvedSpan: { date: "2026-10-06", endDate: null } })).toBe(true);
    expect(parse({ ...row, approvedSpan: { date: "2026-10-06", endDate: null, who: 1 } })).toBe(false);
  });
});
