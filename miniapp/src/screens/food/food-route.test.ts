import { describe, it, expect } from "vitest";
import { foodRouteFromSearch } from "./food-route";

describe("foodRouteFromSearch", () => {
  it("читает экран и подэкран из ссылки бота", () => {
    expect(foodRouteFromSearch("?screen=orders")).toEqual({ view: "list" });
    expect(foodRouteFromSearch("?screen=orders&new=poll")).toEqual({ view: "new-poll" });
    expect(foodRouteFromSearch("?screen=orders&new=order")).toEqual({ view: "new-order" });
    expect(foodRouteFromSearch("?screen=orders&order=12")).toEqual({ view: "order", orderId: 12 });
  });

  it("чужой экран и мусор в номере — не наш маршрут или список", () => {
    expect(foodRouteFromSearch("?screen=sick")).toBeNull();
    expect(foodRouteFromSearch("")).toBeNull();
    expect(foodRouteFromSearch("?screen=orders&order=abc")).toEqual({ view: "list" });
    expect(foodRouteFromSearch("?screen=orders&new=hack")).toEqual({ view: "list" });
  });
});
