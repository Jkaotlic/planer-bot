import { describe, it, expect } from "vitest";
import { defaultEventEnd, mySelfEntries, screenFromSearch } from "./SelfEntryScreen";

describe("форма мероприятия", () => {
  it("конец предзаполняется как «начало + 2 часа»", () => {
    expect(defaultEventEnd("14:00")).toBe("16:00");
  });

  it("поздний старт не уезжает за полночь", () => {
    // 23:30 + 2ч = 01:30 следующего дня, а запись однодневная —
    // упираем в конец суток, а не молча создаём перевёрнутый диапазон.
    expect(defaultEventEnd("23:30")).toBe("23:59");
  });
});

describe("вход по кнопке из бота", () => {
  it("?screen=sick открывает форму больничного", () => {
    expect(screenFromSearch("?screen=sick")).toBe("sick");
  });
  it("?screen=event открывает форму мероприятия", () => {
    expect(screenFromSearch("?screen=event")).toBe("event");
  });
  it("?screen=shift открывает форму своей смены", () => {
    expect(screenFromSearch("?screen=shift")).toBe("shift");
  });
  it("мусор не открывает ничего", () => {
    expect(screenFromSearch("?screen=%D1%84%D1%8B%D0%B2")).toBeNull();
    expect(screenFromSearch("")).toBeNull();
  });
});

describe("что человек видит в списке своих записей", () => {
  const TODAY = "2026-08-12";
  const rows = [
    { id: 1, category: "shift" as const, date: "2026-08-13", endDate: null },
    { id: 2, category: "sick_leave" as const, date: "2026-08-10", endDate: "2026-08-12" },
    { id: 3, category: "offsite" as const, date: "2026-08-20", endDate: null },
    // Кончилась вчера: сервер её править уже не даст, значит и в списке ей не место.
    { id: 4, category: "sick_leave" as const, date: "2026-08-01", endDate: "2026-08-11" },
    { id: 5, category: "vacation" as const, date: "2026-08-25", endDate: "2026-08-30" },
  ];

  it("только то, что сервер разрешит править — и ни одной чужой категории", () => {
    expect(mySelfEntries(rows, TODAY).map((r) => r.id)).toEqual([2, 3]);
  });

  it("по возрастанию даты — ближайшее сверху", () => {
    const shuffled = [rows[2]!, rows[1]!];
    expect(mySelfEntries(shuffled, TODAY).map((r) => r.id)).toEqual([2, 3]);
  });
});
