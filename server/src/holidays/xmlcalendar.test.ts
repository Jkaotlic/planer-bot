import { describe, it, expect, vi } from "vitest";
import { parseXmlCalendar, xmlcalendarFetcher } from "./xmlcalendar";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<calendar year="2024" lang="ru" country="ru">
  <holidays>
    <holiday id="1" title="Новогодние каникулы"/>
    <holiday id="8" title="День народного единства"/>
  </holidays>
  <days>
    <day d="01.01" t="1" h="1"/>
    <day d="04.27" t="3" />
    <day d="04.29" t="1" f="04.27"/>
    <day d="11.02" t="2"/>
    <day d="11.04" t="1" h="8"/>
  </days>
</calendar>`;

describe("parseXmlCalendar", () => {
  it("читает праздники, переносы, рабочие субботы и сокращённые дни", () => {
    expect(parseXmlCalendar(SAMPLE)).toEqual({
      year: 2024,
      days: [
        { date: "2024-01-01", kind: "holiday", note: "Новогодние каникулы" },
        { date: "2024-04-27", kind: "workday", note: "Рабочий день по переносу" },
        { date: "2024-04-29", kind: "holiday", note: "Выходной по переносу с 27 апреля" },
        { date: "2024-11-02", kind: "short", note: null },
        { date: "2024-11-04", kind: "holiday", note: "День народного единства" },
      ],
    });
  });

  it("без <calendar year> — ошибка по-русски", () => {
    expect(() => parseXmlCalendar("<html>Ошибка 502</html>")).toThrow(/не похоже на календарь/);
  });

  it("неизвестный тип дня пропускается, а не ломает год", () => {
    expect(parseXmlCalendar(SAMPLE.replace('t="2"', 't="9"')).days.map((d) => d.date)).not.toContain("2024-11-02");
  });
});

describe("xmlcalendarFetcher", () => {
  it("200 → ok с телом, 404 → missing, сеть → error", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/2026/calendar.xml")) return new Response(SAMPLE, { status: 200 });
      if (url.endsWith("/2027/calendar.xml")) return new Response("", { status: 404 });
      throw new TypeError("fetch failed");
    });
    const fetchYear = xmlcalendarFetcher(fetchImpl as unknown as typeof fetch);
    expect(await fetchYear(2026)).toEqual({ status: "ok", xml: SAMPLE });
    expect(await fetchYear(2027)).toEqual({ status: "missing" });
    expect(await fetchYear(2028)).toMatchObject({ status: "error", message: expect.stringContaining("fetch failed") });
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://xmlcalendar.ru/data/ru/2026/calendar.xml");
  });

  it("500 — error, а не missing: временную беду не путать с «года ещё нет»", async () => {
    const fetchYear = xmlcalendarFetcher((async () => new Response("", { status: 500 })) as unknown as typeof fetch);
    expect(await fetchYear(2026)).toMatchObject({ status: "error" });
  });
});
