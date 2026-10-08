import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { activeMenuItem, archivePlace, createPlace, getPlaceView, listPlaces, updatePlace } from "./place-service";

function stage() {
  const db = makeTestDb();
  const anya = createEmployee(db, { displayName: "Аня" });
  const place = createPlace(db, { name: "Шаурмечная", menu: [{ name: "Шаурма", price: 350, unit: "pcs", stepGrams: null }, { name: "Лаваш", price: 200, unit: "pcs", stepGrams: null }] }, anya.id);
  return { db, anya, place };
}

describe("места", () => {
  it("меню сохраняется в порядке ввода", () => {
    const { place } = stage();
    expect(place.menu.map((m) => [m.name, m.price])).toEqual([["Шаурма", 350], ["Лаваш", 200]]);
  });

  it("кг-позиция сохраняет единицу и шаг при создании и правке, возврат в штуки обнуляет шаг", () => {
    const { db, anya, place } = stage();
    expect(place.menu.map((m) => [m.unit, m.stepGrams])).toEqual([["pcs", null], ["pcs", null]]);
    const caviar = createPlace(db, { name: "Икра", menu: [{ name: "Кетовая", price: 2400, unit: "kg", stepGrams: 400 }] }, anya.id);
    expect(caviar.menu[0]).toMatchObject({ unit: "kg", stepGrams: 400 });
    const id = caviar.menu[0]!.id;
    const edited = updatePlace(db, caviar.id, { name: "Икра", menu: [{ id, name: "Кетовая", price: 2400, unit: "kg", stepGrams: 500 }, { name: "Красная", price: 1900, unit: "kg", stepGrams: 250 }] });
    expect(edited.place!.menu.map((m) => [m.unit, m.stepGrams])).toEqual([["kg", 500], ["kg", 250]]);
    // Возврат в штуки обнуляет шаг, а не оставляет его висеть.
    const back = updatePlace(db, caviar.id, { name: "Икра", menu: [{ id, name: "Кетовая", price: 2400, unit: "pcs", stepGrams: null }] });
    expect(back.place!.menu[0]).toMatchObject({ unit: "pcs", stepGrams: null });
  });

  it("правка: блюдо с id меняет цену, новое добавляется, пропавшее уходит в архив", () => {
    const { db, place } = stage();
    const [shawarma, lavash] = place.menu;
    const result = updatePlace(db, place.id, { name: "Шаурмечная у метро", menu: [{ id: shawarma!.id, name: "Шаурма", price: 380, unit: "pcs", stepGrams: null }, { name: "Чай", price: 50, unit: "pcs", stepGrams: null }] });
    expect(result.ok).toBe(true);
    expect(getPlaceView(db, place.id)!.menu.map((m) => [m.name, m.price])).toEqual([["Шаурма", 380], ["Чай", 50]]);
    expect(activeMenuItem(db, place.id, lavash!.id)).toBeUndefined();
    expect(activeMenuItem(db, place.id, shawarma!.id)!.price).toBe(380);
  });

  it("чужое блюдо по id не правится — id другого места", () => {
    const { db, anya, place } = stage();
    const other = createPlace(db, { name: "Додо", menu: [{ name: "Пицца", price: 600, unit: "pcs", stepGrams: null }] }, anya.id);
    const result = updatePlace(db, place.id, { name: "Шаурмечная", menu: [{ id: other.menu[0]!.id, name: "Пицца", price: 1, unit: "pcs", stepGrams: null }] });
    expect(result).toEqual({ ok: false, error: "Меню уже поменяли — открой место заново." });
    expect(getPlaceView(db, other.id)!.menu[0]!.price).toBe(600);
  });

  // Тот же отказ, что и у чужого блюда: id, который был в меню, но кто-то
  // другой уже успел его архивировать (правка старого снимка формы) —
  // человек должен перечитать место заново, а не воскресить архивную строку.
  it("правка старым снимком меню (блюдо уже архивировано) — тот же отказ, что у чужого места", () => {
    const { db, place } = stage();
    const [shawarma] = place.menu;
    expect(updatePlace(db, place.id, { name: "Шаурмечная", menu: [] }).ok).toBe(true);
    const stale = updatePlace(db, place.id, { name: "Шаурмечная", menu: [{ id: shawarma!.id, name: "Шаурма", price: 350, unit: "pcs", stepGrams: null }] });
    expect(stale).toEqual({ ok: false, error: "Меню уже поменяли — открой место заново." });
  });

  it("архивное место пропадает из списка и не правится", () => {
    const { db, place } = stage();
    expect(archivePlace(db, place.id)).toEqual({ ok: true });
    expect(listPlaces(db)).toEqual([]);
    expect(getPlaceView(db, place.id)).toBeNull();
    expect(updatePlace(db, place.id, { name: "X", menu: [] }).ok).toBe(false);
  });
});
