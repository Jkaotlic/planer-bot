import { describe, it, expect } from "vitest";
import { makeTestDb } from "./testdb";
import { seedDefaultTemplates } from "./seed";
import { shiftTemplates } from "./schema";

describe("seedDefaultTemplates", () => {
  it("inserts the default presets with Friday overrides, late flags, and the Поклонка duty", () => {
    const db = makeTestDb();
    seedDefaultTemplates(db);
    const rows = db.select().from(shiftTemplates).orderBy(shiftTemplates.sortOrder).all();
    expect(rows.map((r) => r.name)).toEqual(["Утро", "День", "Вечер", "Ночь", "Дежурство · Поклонка"]);

    const evening = rows.find((r) => r.name === "Вечер")!;
    expect(evening.fridayStart).toBe("12:00");
    expect(evening.isLate).toBe(true);

    const night = rows.find((r) => r.name === "Ночь")!;
    expect(night.isLate).toBe(true);
    expect(night.sendReminder).toBe(true);

    const morning = rows.find((r) => r.name === "Утро")!;
    expect(morning.fridayEnd).toBe("15:45");
    expect(morning.sendReminder).toBe(true);
    expect(morning.category).toBe("shift");

    const poklonka = rows.find((r) => r.name === "Дежурство · Поклонка")!;
    expect(poklonka.category).toBe("duty");
    expect(poklonka.location).toBe("Поклонка");

    // Every preset gets its own colour slot so shifts read apart in the schedule.
    expect(rows.map((r) => r.accent)).toEqual(["gold", "blue", "violet", "indigo", "teal"]);
  });

  it("backfills presentation fields on presets seeded before those columns existed", () => {
    const db = makeTestDb();
    // Simulate an old row: right name, but default/blank presentation.
    db.insert(shiftTemplates)
      .values({ name: "Утро", start: "08:00", end: "17:00", fridayStart: "08:00", fridayEnd: "15:45", sortOrder: 0 })
      .run();
    seedDefaultTemplates(db);
    const morning = db.select().from(shiftTemplates).all().find((r) => r.name === "Утро")!;
    expect(morning.accent).toBe("gold"); // was the "blue" column default
    expect(db.select().from(shiftTemplates).all()).toHaveLength(5); // no duplicate «Утро»
  });

  it("is idempotent (running twice keeps the same rows)", () => {
    const db = makeTestDb();
    seedDefaultTemplates(db);
    seedDefaultTemplates(db);
    expect(db.select().from(shiftTemplates).all().length).toBe(5);
  });
});
