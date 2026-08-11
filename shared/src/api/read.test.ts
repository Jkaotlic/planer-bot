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
