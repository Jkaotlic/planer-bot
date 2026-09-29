import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { activeMenuItem, archivePlace, createPlace, getPlaceView, listPlaces, updatePlace } from "./place-service";

function stage() {
  const db = makeTestDb();
  const anya = createEmployee(db, { displayName: "Аня" });
  const place = createPlace(db, { name: "Шаурмечная", menu: [{ name: "Шаурма", price: 350 }, { name: "Лаваш", price: 200 }] }, anya.id);
  return { db, anya, place };
}

describe("места", () => {
  it("меню сохраняется в порядке ввода", () => {
    const { place } = stage();
    expect(place.menu.map((m) => [m.name, m.price])).toEqual([["Шаурма", 350], ["Лаваш", 200]]);
  });

  it("правка: блюдо с id меняет цену, новое добавляется, пропавшее уходит в архив", () => {
    const { db, place } = stage();
    const [shawarma, lavash] = place.menu;
    const result = updatePlace(db, place.id, { name: "Шаурмечная у метро", menu: [{ id: shawarma!.id, name: "Шаурма", price: 380 }, { name: "Чай", price: 50 }] });
    expect(result.ok).toBe(true);
    expect(getPlaceView(db, place.id)!.menu.map((m) => [m.name, m.price])).toEqual([["Шаурма", 380], ["Чай", 50]]);
    expect(activeMenuItem(db, place.id, lavash!.id)).toBeUndefined();
    expect(activeMenuItem(db, place.id, shawarma!.id)!.price).toBe(380);
  });

  it("чужое блюдо по id не правится — id другого места", () => {
    const { db, anya, place } = stage();
    const other = createPlace(db, { name: "Додо", menu: [{ name: "Пицца", price: 600 }] }, anya.id);
    const result = updatePlace(db, place.id, { name: "Шаурмечная", menu: [{ id: other.menu[0]!.id, name: "Пицца", price: 1 }] });
    expect(result).toEqual({ ok: false, error: "В меню блюдо из другого места." });
    expect(getPlaceView(db, other.id)!.menu[0]!.price).toBe(600);
  });

  it("архивное место пропадает из списка и не правится", () => {
    const { db, place } = stage();
    expect(archivePlace(db, place.id)).toEqual({ ok: true });
    expect(listPlaces(db)).toEqual([]);
    expect(getPlaceView(db, place.id)).toBeNull();
    expect(updatePlace(db, place.id, { name: "X", menu: [] }).ok).toBe(false);
  });
});
