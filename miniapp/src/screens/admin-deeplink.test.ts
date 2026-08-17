import { describe, it, expect } from "vitest";
import { adminSectionFromSearch } from "./AdminScreen";

describe("adminSectionFromSearch", () => {
  it("?screen=announce открывает раздел анонсов", () => {
    expect(adminSectionFromSearch("?screen=announce")).toBe("announce");
  });
  it("чужие и пустые значения — null, экран открывается как обычно", () => {
    expect(adminSectionFromSearch("?screen=sick")).toBeNull();
    expect(adminSectionFromSearch("?screen=%D1%84%D1%8B%D0%B2")).toBeNull();
    expect(adminSectionFromSearch("")).toBeNull();
  });
});
