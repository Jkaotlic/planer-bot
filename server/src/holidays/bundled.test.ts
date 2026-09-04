import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { BUNDLED_YEARS } from "./bundled";
import { parseXmlCalendar } from "./xmlcalendar";

describe("зашитый календарь", () => {
  it("2026 совпадает с разбором снятой копии источника", () => {
    const xml = readFileSync(new URL("./fixtures/ru-2026.xml", import.meta.url), "utf8");
    expect(BUNDLED_YEARS[2026]).toEqual(parseXmlCalendar(xml));
  });

  it("в 2026 году 18 дней отдыха вне выходных и ни одной рабочей субботы", () => {
    const days = BUNDLED_YEARS[2026]!.days;
    expect(days.filter((d) => d.kind === "holiday")).toHaveLength(18);
    expect(days.filter((d) => d.kind === "workday")).toHaveLength(0);
  });
});
