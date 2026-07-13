import { describe, it, expect } from "vitest";
import { makeTestDb } from "./testdb";
import { seedDefaultTemplates } from "./seed";
import { shiftTemplates } from "./schema";

describe("seedDefaultTemplates", () => {
  it("inserts the four presets with Friday overrides and late flags", () => {
    const db = makeTestDb();
    seedDefaultTemplates(db);
    const rows = db.select().from(shiftTemplates).orderBy(shiftTemplates.sortOrder).all();
    expect(rows.map((r) => r.name)).toEqual(["Утро", "День", "Вечер", "Ночь"]);

    const evening = rows.find((r) => r.name === "Вечер")!;
    expect(evening.fridayStart).toBe("12:00");
    expect(evening.isLate).toBe(true);

    const night = rows.find((r) => r.name === "Ночь")!;
    expect(night.isLate).toBe(true);
    expect(night.sendReminder).toBe(true);

    const morning = rows.find((r) => r.name === "Утро")!;
    expect(morning.fridayEnd).toBe("15:45");
    expect(morning.sendReminder).toBe(true);
  });

  it("is idempotent (running twice keeps four rows)", () => {
    const db = makeTestDb();
    seedDefaultTemplates(db);
    seedDefaultTemplates(db);
    expect(db.select().from(shiftTemplates).all().length).toBe(4);
  });
});
