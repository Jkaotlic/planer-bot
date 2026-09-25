import { describe, expect, it } from "vitest";
import { withError, withoutError, weekendOfferErrorMessage } from "./error-map";

describe("withError/withoutError", () => {
  it("adds and removes a message by id without touching the rest", () => {
    const withMsg = withError(new Map(), 1, "Ошибка");
    expect(withMsg.get(1)).toBe("Ошибка");
    expect(withoutError(withMsg, 1).has(1)).toBe(false);
  });
});

describe("weekendOfferErrorMessage", () => {
  it("«not_participating» — единственный код, показанный буквально", () => {
    expect(weekendOfferErrorMessage(new Error("not_participating"), "запасной текст"))
      .toBe("Ты сейчас не участвуешь в раздаче выходных");
  });

  it("остальные коды остаются общей фразой — они не значат ничего конкретного работнику", () => {
    for (const code of ["not_yours", "not_offered", "slot_passed"]) {
      expect(weekendOfferErrorMessage(new Error(code), "запасной текст")).toBe("запасной текст");
    }
  });

  it("не-Error (например, сбой сети) тоже падает на запасной текст", () => {
    expect(weekendOfferErrorMessage("network down", "запасной текст")).toBe("запасной текст");
  });
});
