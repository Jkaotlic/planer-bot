import { describe, expect, it } from "vitest";
import { filterPeople, matchesPerson, shouldShowPersonSearch } from "./person-search";

const anya = { displayName: "Иванова Анна", preferredName: "Нюта" };
const igor = { displayName: "Петров Игорь", preferredName: null };
const semen = { displayName: "Семёнов Марк", preferredName: null };

describe("совпадение имени", () => {
  it("пустой и пробельный запрос совпадают со всеми — поле, в которое не ввели, ничего не прячет", () => {
    expect(matchesPerson(igor, "")).toBe(true);
    expect(matchesPerson(igor, "   ")).toBe(true);
  });

  it("находит по фамилии и не находит чужого", () => {
    expect(matchesPerson(anya, "иванова")).toBe(true);
    expect(matchesPerson(igor, "иванова")).toBe(false);
  });

  it("регистр не важен", () => {
    expect(matchesPerson(anya, "ИВАНОВА")).toBe(true);
  });

  it("«ё» и «е» — одна буква: «семенов» находит «Семёнова»", () => {
    expect(matchesPerson(semen, "семенов")).toBe(true);
    expect(matchesPerson(semen, "семёнов")).toBe(true);
  });

  it("два слова совпадают в любом порядке", () => {
    expect(matchesPerson(anya, "ан ив")).toBe(true);
    expect(matchesPerson(anya, "ив ан")).toBe(true);
    expect(matchesPerson(anya, "ив петров")).toBe(false);
  });

  it("совпадает серединой слова — люди ищут по куску фамилии", () => {
    expect(matchesPerson(anya, "ванов")).toBe(true);
  });

  it("находит по тому, как человек попросил себя называть", () => {
    expect(matchesPerson(anya, "нюта")).toBe(true);
    expect(matchesPerson(igor, "нюта")).toBe(false);
  });

  it("человек без preferredName не ломает поиск", () => {
    expect(matchesPerson({ displayName: "Петров Игорь" }, "игорь")).toBe(true);
  });
});

describe("фильтр списка", () => {
  it("сохраняет порядок исходного списка и не мутирует его", () => {
    const people = [semen, anya, igor];
    expect(filterPeople(people, "о").map((p) => p.displayName)).toEqual([
      "Семёнов Марк", "Иванова Анна", "Петров Игорь",
    ]);
    expect(people).toEqual([semen, anya, igor]);
  });

  it("пустой запрос возвращает всех", () => {
    expect(filterPeople([anya, igor], "  ")).toHaveLength(2);
  });
});

describe("порог показа", () => {
  it("на пяти поля нет, на шести есть", () => {
    expect(shouldShowPersonSearch(5)).toBe(false);
    expect(shouldShowPersonSearch(6)).toBe(true);
  });
});
