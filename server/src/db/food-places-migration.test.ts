import { describe, it, expect } from "vitest";
import { makeTestDb } from "./testdb";
import { createEmployee } from "../repo/employees";
import { foodMenuItems, foodPlaces } from "./schema";

describe("миграция 0038 — места и меню", () => {
  it("место и блюдо сохраняются, архив по умолчанию пуст", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const place = db.insert(foodPlaces).values({ name: "Шаурмечная", createdBy: anya.id }).returning().get();
    const item = db.insert(foodMenuItems).values({ placeId: place.id, name: "Шаурма", price: 350, position: 0 }).returning().get();
    expect(place.archivedAt).toBeNull();
    expect(item.archivedAt).toBeNull();
  });
});
