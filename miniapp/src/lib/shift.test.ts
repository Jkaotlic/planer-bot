import { describe, expect, it } from "vitest";
import { notifyNotice, notifyPendingNotice, withNotifyNotice } from "./shift";

describe("notifyNotice", () => {
  it("молчит, когда дошло до всех", () => expect(notifyNotice({ delivered: 3, intended: 3 })).toBeNull());
  it("говорит, когда дошло не до всех", () =>
    expect(notifyNotice({ delivered: 1, intended: 3 })).toBe("Уведомление дошло до 1 из 3: остальные не подключили телеграм."));
  it("молчит, когда уведомлять было некого", () => expect(notifyNotice({ delivered: 0, intended: 0 })).toBeNull());
});

describe("withNotifyNotice", () => {
  it("возвращает базовую строку без изменений, когда добавить нечего", () => {
    expect(withNotifyNotice("Заполнено дней: 3.", { delivered: 2, intended: 2 })).toBe("Заполнено дней: 3.");
  });

  it("приписывает предупреждение к базовой строке через пробел", () => {
    expect(withNotifyNotice("Заполнено дней: 3.", { delivered: 1, intended: 2 })).toBe(
      "Заполнено дней: 3. Уведомление дошло до 1 из 2: остальные не подключили телеграм.",
    );
  });
});

describe("текст про доставку уведомления", () => {
  it("про уже отправленное говорит «дошло»", () => {
    expect(notifyNotice({ delivered: 0, intended: 1 })).toBe(
      "Уведомление дошло до 0 из 1: остальные не подключили телеграм.",
    );
  });

  it("про ещё не отправленное говорит «уйдёт»", () => {
    // Одиночная правка ждёт в буфере сервера — доставки в момент ответа не было.
    expect(notifyPendingNotice({ delivered: 0, intended: 1 })).toBe(
      "Уведомление уйдёт 0 из 1: остальные не подключили телеграм.",
    );
  });

  it("оба молчат, когда сказать нечего", () => {
    for (const reach of [{ delivered: 1, intended: 1 }, { delivered: 0, intended: 0 }]) {
      expect(notifyNotice(reach)).toBeNull();
      expect(notifyPendingNotice(reach)).toBeNull();
    }
  });
});
