import { describe, it, expect } from "vitest";
import { allowedByPool } from "./kind-roles";

const ANYA = 1, IGOR = 2;

describe("allowedByPool", () => {
  it("читает пустой пул как «допущены все»", () => {
    expect(allowedByPool([], IGOR)).toBe(true);
    expect(allowedByPool(null, IGOR)).toBe(true);
    expect(allowedByPool(undefined, IGOR)).toBe(true);
  });

  it("непустой пул допускает только своих", () => {
    expect(allowedByPool([ANYA], ANYA)).toBe(true);
    expect(allowedByPool([ANYA], IGOR)).toBe(false);
  });
});
