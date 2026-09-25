import { describe, expect, it } from "vitest";
import { buildIcs, type IcsEntry } from "./ics";

const TZ = "Europe/Moscow";
const NOW_MS = Date.UTC(2026, 6, 10, 12, 0, 0);

function entry(patch: Partial<IcsEntry> & { id: number }): IcsEntry {
  return {
    date: "2026-07-15",
    endDate: null,
    start: null,
    end: null,
    summary: "Смена",
    location: null,
    updatedAtMs: NOW_MS,
    ...patch,
  };
}

/** Обратная операция свёртки RFC 5545: убирает "\r\n " перед сверенным продолжением. */
function unfold(ics: string): string {
  return ics.replace(/\r\n /g, "");
}

describe("buildIcs", () => {
  it("дневная смена со временем — DTSTART/DTEND в UTC", () => {
    const ics = buildIcs([entry({ id: 1, date: "2026-07-15", start: "09:00", end: "18:00" })], {
      tz: TZ,
      nowMs: NOW_MS,
      calName: "Мои смены",
    });
    expect(unfold(ics)).toContain("DTSTART:20260715T060000Z");
    expect(unfold(ics)).toContain("DTEND:20260715T150000Z");
  });

  it("ночная смена — конец на следующий день", () => {
    const ics = buildIcs([entry({ id: 2, date: "2026-07-15", start: "23:00", end: "07:00" })], {
      tz: TZ,
      nowMs: NOW_MS,
      calName: "Мои смены",
    });
    expect(unfold(ics)).toContain("DTSTART:20260715T200000Z");
    expect(unfold(ics)).toContain("DTEND:20260716T040000Z");
  });

  it("запись без времени — событие на весь день, DTEND на день после endDate", () => {
    const ics = buildIcs([entry({ id: 3, date: "2026-07-20", endDate: "2026-07-26", start: null, end: null })], {
      tz: TZ,
      nowMs: NOW_MS,
      calName: "Мои смены",
    });
    expect(unfold(ics)).toContain("DTSTART;VALUE=DATE:20260720");
    expect(unfold(ics)).toContain("DTEND;VALUE=DATE:20260727");
  });

  it("запись без endDate — DTEND на день после одиночной date", () => {
    const ics = buildIcs([entry({ id: 4, date: "2026-07-20", endDate: null, start: null, end: null })], {
      tz: TZ,
      nowMs: NOW_MS,
      calName: "Мои смены",
    });
    expect(unfold(ics)).toContain("DTSTART;VALUE=DATE:20260720");
    expect(unfold(ics)).toContain("DTEND;VALUE=DATE:20260721");
  });

  it("экранирует запятую, точку с запятой и обратный слэш в summary", () => {
    const ics = buildIcs([entry({ id: 5, summary: 'Смена, «А»; тест\\x' })], {
      tz: TZ,
      nowMs: NOW_MS,
      calName: "Мои смены",
    });
    expect(unfold(ics)).toContain('SUMMARY:Смена\\, «А»\\; тест\\\\x');
  });

  it("экранирует перенос строки в location как \\n", () => {
    const ics = buildIcs([entry({ id: 6, location: "Поклонка\nвторой этаж" })], {
      tz: TZ,
      nowMs: NOW_MS,
      calName: "Мои смены",
    });
    expect(unfold(ics)).toContain("LOCATION:Поклонка\\nвторой этаж");
  });

  // Форма могла прийти с Windows: `\r\n`. Голый `\r` в property RFC 5545 не
  // разрешает, и он не должен долетать до файла необработанным.
  it("нормализует \\r\\n в один перенос перед экранированием", () => {
    const ics = buildIcs([entry({ id: 61, location: "Поклонка\r\nвторой этаж" })], {
      tz: TZ,
      nowMs: NOW_MS,
      calName: "Мои смены",
    });
    expect(unfold(ics)).toContain("LOCATION:Поклонка\\nвторой этаж");
    expect(ics).not.toContain("\rвторой");
  });

  it("нормализует одиночный \\r (старый Mac) в перенос", () => {
    const ics = buildIcs([entry({ id: 62, location: "Поклонка\rвторой этаж" })], {
      tz: TZ,
      nowMs: NOW_MS,
      calName: "Мои смены",
    });
    expect(unfold(ics)).toContain("LOCATION:Поклонка\\nвторой этаж");
  });

  it("сворачивает длинную строку по 75 октетам, продолжение — с пробела, склейка даёт исходное", () => {
    const longSummary = "Дежурство на смене выходного дня в главном корпусе с полным списком обязанностей и передачей ключей";
    const ics = buildIcs([entry({ id: 7, summary: longSummary })], {
      tz: TZ,
      nowMs: NOW_MS,
      calName: "Мои смены",
    });
    const encoder = new TextEncoder();
    const physicalLines = ics.split("\r\n").filter((l) => l.length > 0);
    for (const line of physicalLines) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    // Хотя бы одна свёрнутая строка есть — иначе тест ничего не проверяет.
    expect(physicalLines.some((l) => l.startsWith(" "))).toBe(true);
    expect(unfold(ics)).toContain(`SUMMARY:${longSummary}`);
  });

  it("общая структура: CRLF, границы календаря, UID, метаданные обновления, без VALARM", () => {
    const ics = buildIcs([entry({ id: 42, updatedAtMs: Date.UTC(2026, 6, 1, 8, 30, 0) })], {
      tz: TZ,
      nowMs: NOW_MS,
      calName: "Мои смены",
    });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(unfold(ics)).toContain("UID:shift-42@planer");
    expect(unfold(ics)).toContain("X-WR-CALNAME:Мои смены");
    expect(unfold(ics)).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(unfold(ics)).toContain("X-PUBLISHED-TTL:PT1H");
    expect(unfold(ics)).toContain("LAST-MODIFIED:20260701T083000Z");
    expect(ics).not.toContain("VALARM");
  });

  it("пустой список записей — валидный пустой календарь", () => {
    const ics = buildIcs([], { tz: TZ, nowMs: NOW_MS, calName: "Мои смены" });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});
