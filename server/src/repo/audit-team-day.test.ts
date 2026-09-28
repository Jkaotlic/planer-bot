import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { auditLog } from "../db/schema";
import { queryAudit } from "./audit";

/**
 * «За 5 августа» — это командные сутки, а не UTC.
 *
 * Границы строились как `T00:00:00Z`: при поясе команды Москва фильтр «за 5-е»
 * охватывал 03:00 5-го — 02:59 6-го по МСК. Правка графика в час ночи 5-го в
 * выдачу за 5-е не попадала, а ночные события 6-го — попадали.
 */
describe("queryAudit по командным суткам", () => {
  it("01:30 МСК 5-го — за 5-е; 00:30 МСК 6-го — уже не за 5-е", () => {
    const db = makeTestDb();
    db.insert(auditLog).values([
      { type: "entry_created", actorEmployeeId: null, payload: { n: "ночь 5-го" }, createdAt: new Date("2026-08-04T22:30:00Z") },
      { type: "entry_created", actorEmployeeId: null, payload: { n: "ночь 6-го" }, createdAt: new Date("2026-08-05T21:30:00Z") },
    ]).run();

    const page = queryAudit(db, { from: "2026-08-05", to: "2026-08-05", limit: 50, teamTz: "Europe/Moscow" });

    expect(page.rows.map((r) => (r.payload as { n: string }).n)).toEqual(["ночь 5-го"]);
  });
});
