import { describe, it, expect } from "vitest";
import { adminSectionFromSearch, scheduleDateFromSearch } from "./admin-section";

describe("adminSectionFromSearch", () => {
  it("?screen=announce открывает раздел анонсов", () => {
    expect(adminSectionFromSearch("?screen=announce")).toBe("announce");
  });
  it("?screen=schedule открывает расписание", () => {
    expect(adminSectionFromSearch("?screen=schedule")).toBe("schedule");
  });
  it("чужие и пустые значения — null, экран открывается как обычно", () => {
    expect(adminSectionFromSearch("?screen=sick")).toBeNull();
    expect(adminSectionFromSearch("?screen=%D1%84%D1%8B%D0%B2")).toBeNull();
    expect(adminSectionFromSearch("")).toBeNull();
  });
});

describe("scheduleDateFromSearch", () => {
  it("достаёт валидную дату из ссылки на график", () => {
    expect(scheduleDateFromSearch("?screen=schedule&date=2026-10-07")).toBe("2026-10-07");
  });
  it("неверная дата (несуществующий месяц/день) — null, без прыжка", () => {
    expect(scheduleDateFromSearch("?screen=schedule&date=2026-13-40")).toBeNull();
  });
  it("не похожее на дату значение — null", () => {
    expect(scheduleDateFromSearch("?screen=schedule&date=x")).toBeNull();
  });
  it("без параметра date — null", () => {
    expect(scheduleDateFromSearch("?screen=schedule")).toBeNull();
  });
});
