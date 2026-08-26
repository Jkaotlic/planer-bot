import { describe, it, expect } from "vitest";
import { URLSearchParams } from "node:url";
import { signInitData, validateInitData, INIT_DATA_MAX_AGE_SEC } from "./telegram";

const BOT = "12345:test-token";
const NOW = 1_800_000_000;
const initDataFor = (over: Record<string, string> = {}) =>
  signInitData({ auth_date: String(NOW), user: JSON.stringify({ id: 555, first_name: "Аня", username: "anya" }), ...over }, BOT);

describe("validateInitData", () => {
  it("accepts a freshly signed initData and parses the user", () => {
    const res = validateInitData(initDataFor(), BOT, { nowSec: NOW });
    expect(res.user).toEqual({ id: 555, firstName: "Аня", lastName: undefined, username: "anya" });
    expect(res.authDate).toBe(NOW);
  });

  it("rejects data tampered after signing", () => {
    const params = new URLSearchParams(initDataFor());
    params.set("user", JSON.stringify({ id: 999 })); // change payload, keep old hash
    expect(() => validateInitData(params.toString(), BOT, { nowSec: NOW })).toThrow();
  });

  it("rejects a wrong bot token", () => {
    expect(() => validateInitData(initDataFor(), "999:other", { nowSec: NOW })).toThrow();
  });

  it("rejects expired initData", () => {
    expect(() => validateInitData(initDataFor(), BOT, { nowSec: NOW + 3600, maxAgeSec: 300 })).toThrow();
  });

  /**
   * Окно свежести — не косметика, а то, из-за чего мини-апп «не открывался».
   *
   * Клиент переспрашивает токен ТЕМ ЖЕ `initData`, с которым открылся вебвью:
   * его `auth_date` не обновляется никогда. При окне в пять минут это значило,
   * что любая переавторизация позже пятой минуты жизни вебвью не может пройти
   * в принципе — и мини-апп вставал намертво. Сутки — столько же, сколько
   * держат референсные реализации Telegram.
   */
  it("держит вход открытым сутки — столько живёт вебвью, а не пять минут", () => {
    expect(INIT_DATA_MAX_AGE_SEC).toBe(24 * 3600);
    const sixMinutes = NOW + 6 * 60;
    expect(() => validateInitData(initDataFor(), BOT, { nowSec: sixMinutes })).not.toThrow();
    const almostDay = NOW + INIT_DATA_MAX_AGE_SEC;
    expect(() => validateInitData(initDataFor(), BOT, { nowSec: almostDay })).not.toThrow();
  });

  it("но не бесконечно: сутки с секундой — уже отказ", () => {
    // Подпись доказывает подлинность, окно ограничивает переигрывание
    // перехваченного `initData`. Без верхней границы его не было бы вовсе.
    const pastDay = NOW + INIT_DATA_MAX_AGE_SEC + 1;
    expect(() => validateInitData(initDataFor(), BOT, { nowSec: pastDay })).toThrow(/expired/);
  });
});
