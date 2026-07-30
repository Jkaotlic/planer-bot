import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, listActive, reorderEmployee, archiveEmployee, restoreEmployee } from "./employees";
import type { Db } from "../db/client";

/** Six people in a known order, numbered 0..5 the way an import leaves them. */
function team(db: Db): number[] {
  const ids = ["Первый", "Второй", "Третий", "Четвёртый", "Пятый", "Шестой"].map(
    (displayName) => createEmployee(db, { displayName }).id,
  );
  ids.forEach((id, index) => reorderEmployee(db, id, index + 1));
  return ids;
}

const names = (db: Db) => listActive(db).map((e) => e.displayName);

describe("listActive", () => {
  it("returns everyone in the admin's order, not by id", () => {
    const db = makeTestDb();
    const ids = team(db);
    reorderEmployee(db, ids[5]!, 1); // Шестой to the top
    expect(names(db)).toEqual(["Шестой", "Первый", "Второй", "Третий", "Четвёртый", "Пятый"]);
  });

  it("puts a worker with no number yet at the end, never in the middle", () => {
    const db = makeTestDb();
    team(db);
    createEmployee(db, { displayName: "Новенький" });
    expect(names(db).at(-1)).toBe("Новенький");
  });
});

describe("reorderEmployee", () => {
  it("moves a worker down and closes the gap behind them", () => {
    const db = makeTestDb();
    const ids = team(db);
    reorderEmployee(db, ids[0]!, 4);
    expect(names(db)).toEqual(["Второй", "Третий", "Четвёртый", "Первый", "Пятый", "Шестой"]);
  });

  it("moves a worker up", () => {
    const db = makeTestDb();
    const ids = team(db);
    reorderEmployee(db, ids[4]!, 2);
    expect(names(db)).toEqual(["Первый", "Пятый", "Второй", "Третий", "Четвёртый", "Шестой"]);
  });

  it("always leaves the numbers 0..n-1 with no gaps and no duplicates", () => {
    const db = makeTestDb();
    const ids = team(db);
    reorderEmployee(db, ids[3]!, 1);
    reorderEmployee(db, ids[0]!, 6);
    reorderEmployee(db, ids[2]!, 3);

    const orders = listActive(db).map((e) => e.rosterOrder);
    expect(orders).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("clamps a position past either end instead of failing", () => {
    const db = makeTestDb();
    const ids = team(db);
    expect(reorderEmployee(db, ids[2]!, 999)!.at(-1)!.displayName).toBe("Третий");
    expect(reorderEmployee(db, ids[2]!, -4)![0]!.displayName).toBe("Третий");
  });

  it("moving someone to where they already are changes nothing", () => {
    const db = makeTestDb();
    const ids = team(db);
    const before = names(db);
    reorderEmployee(db, ids[2]!, 3);
    expect(names(db)).toEqual(before);
  });

  it("returns null for a worker who is not in the active list", () => {
    const db = makeTestDb();
    const ids = team(db);
    archiveEmployee(db, ids[1]!, "2026-06-01");
    expect(reorderEmployee(db, ids[1]!, 1)).toBeNull();
    expect(reorderEmployee(db, 9999, 1)).toBeNull();
  });

  // The number an archived person keeps is frozen while the active list gets
  // renumbered around them — sooner or later somebody active holds the same one.
  // Then restoring them puts two people on one number and the order between them
  // falls back to id, i.e. wherever they happen to land.
  it("restoring somebody never leaves two people on the same number", () => {
    const db = makeTestDb();
    const ids = team(db);
    archiveEmployee(db, ids[5]!, "2026-06-01");           // keeps 5
    const hired = createEmployee(db, { displayName: "Новенький" }).id;
    reorderEmployee(db, hired, 6);                        // actives renumbered 0..5 — the new one takes 5

    restoreEmployee(db, ids[5]!);

    const orders = listActive(db).map((e) => e.rosterOrder);
    expect(new Set(orders).size).toBe(orders.length);      // no duplicates
    expect(orders).toEqual([0, 1, 2, 3, 4, 5, 6]);         // and no holes
  });

  it("straightens out numbers left skewed by an archive and a restore", () => {
    const db = makeTestDb();
    const ids = team(db);
    archiveEmployee(db, ids[2]!, "2026-06-01"); // leaves a hole at 2
    restoreEmployee(db, ids[2]!);               // comes back still holding 2

    // One move is enough to renumber the whole column contiguously again.
    reorderEmployee(db, ids[0]!, 1);
    expect(listActive(db).map((e) => e.rosterOrder)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
