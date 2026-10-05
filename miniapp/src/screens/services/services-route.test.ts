import { describe, expect, it } from "vitest";
import { servicesFromSearch } from "./services-route";

describe("servicesFromSearch", () => {
  it("?screen=services — да; заказы, больничный и пусто — нет", () => {
    expect(servicesFromSearch("?screen=services")).toBe(true);
    expect(servicesFromSearch("?screen=orders")).toBe(false);
    expect(servicesFromSearch("?screen=sick")).toBe(false);
    expect(servicesFromSearch("")).toBe(false);
  });
});
