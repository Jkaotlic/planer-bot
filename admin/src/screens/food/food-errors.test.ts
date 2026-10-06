import { describe, expect, it, vi } from "vitest";
import { AuthRequiredError } from "../../api/client";
import { failureText } from "./food-errors";

describe("failureText", () => {
  it("истёкшая сессия — не текст рядом с кнопкой, а вход заново", () => {
    const onAuth = vi.fn();
    expect(failureText(new AuthRequiredError("Сессия истекла — войди заново"), "Не получилось", onAuth)).toBeNull();
    expect(onAuth).toHaveBeenCalledTimes(1);
  });

  it("отказ сервера — его текст как есть, сессия не трогается", () => {
    const onAuth = vi.fn();
    expect(failureText(new Error("Приём уже закрыт."), "Не получилось", onAuth)).toBe("Приём уже закрыт.");
    expect(onAuth).not.toHaveBeenCalled();
  });

  it("без текста — запасная фраза, а не пустая красная плашка", () => {
    expect(failureText(new Error(""), "Не получилось", vi.fn())).toBe("Не получилось");
    expect(failureText("строка", "Не получилось", vi.fn())).toBe("Не получилось");
  });
});
