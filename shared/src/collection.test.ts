import { describe, it, expect } from "vitest";
import {
  collectionStatus,
  formatDayMonth,
  formatMoney,
  isCollectionActive,
  type CollectionShape,
} from "./collection";

/** Общий сбор без единой даты — от него отталкиваются все случаи ниже. */
function shape(patch: Partial<CollectionShape> = {}): CollectionShape {
  return {
    kind: "custom",
    employeeId: null,
    celebratedOn: null,
    title: "Кофемашина",
    eventDate: null,
    deadline: null,
    amountPerPerson: null,
    totalGoal: null,
    collectUrl: null,
    closedAt: null,
    sendCount: 0,
    ...patch,
  };
}

describe("collectionStatus", () => {
  it("без ссылки — pending", () => {
    expect(collectionStatus({ collectUrl: null, sendCount: 0 })).toBe("pending");
  });

  it("со ссылкой, но не разослан — ready", () => {
    expect(collectionStatus({ collectUrl: "https://x", sendCount: 0 })).toBe("ready");
  });

  it("разослан хотя бы раз — sent, и это важнее ссылки", () => {
    expect(collectionStatus({ collectUrl: "https://x", sendCount: 1 })).toBe("sent");
    // Ссылку могли убрать после рассылки — «разослано» от этого не отменяется.
    expect(collectionStatus({ collectUrl: null, sendCount: 2 })).toBe("sent");
  });
});

describe("isCollectionActive", () => {
  it("закрытый руками неактивен, даже если все даты в будущем", () => {
    const closed = shape({ closedAt: "2026-08-09T10:00:00Z", deadline: "2026-12-31" });
    expect(isCollectionActive(closed, "2026-08-10")).toBe(false);
    // Тот же сбор без closedAt активен — иначе тест прошёл бы при любой реализации.
    expect(isCollectionActive({ ...closed, closedAt: null }, "2026-08-10")).toBe(true);
  });

  it("дедлайн главнее даты события", () => {
    const c = shape({ deadline: "2026-08-09", eventDate: "2026-12-31" });
    expect(isCollectionActive(c, "2026-08-10")).toBe(false);
    expect(isCollectionActive({ ...c, deadline: "2026-08-10" }, "2026-08-10")).toBe(true);
  });

  it("без дедлайна судит дата события, и сам день события ещё активен", () => {
    const c = shape({ eventDate: "2026-08-10" });
    expect(isCollectionActive(c, "2026-08-10")).toBe(true);
    expect(isCollectionActive(c, "2026-08-11")).toBe(false);
  });

  it("у дня рождения роль дедлайна играет сам праздник", () => {
    const c = shape({ kind: "birthday", employeeId: 7, title: null, celebratedOn: "2026-08-10" });
    expect(isCollectionActive(c, "2026-08-10")).toBe(true);
    expect(isCollectionActive(c, "2026-08-11")).toBe(false);
  });

  it("сбор без единой даты висит, пока его не закроют", () => {
    expect(isCollectionActive(shape(), "2099-01-01")).toBe(true);
  });
});

describe("formatMoney", () => {
  // Разделитель разрядов записан escape-последовательностью намеренно: литеральный
  // U+00A0 в исходнике неотличим от обычного пробела глазами, и ровно так он сюда
  // однажды и попал — тест и реализация были неправы одинаково и потому зелены.
  it("разделяет разряды неразрывным пробелом", () => {
    expect(formatMoney(25000)).toBe("25 000 ₽");
    expect(formatMoney(1000)).toBe("1 000 ₽");
    expect(formatMoney(500)).toBe("500 ₽");
    expect(formatMoney(1234567)).toBe("1 234 567 ₽");
  });

  it("не показывает копеек", () => {
    expect(formatMoney(999.6)).toBe("1 000 ₽");
  });

  it("не пропускает обычный пробел вместо неразрывного", () => {
    // Прямая проверка того самого дефекта: строка не должна содержать 0x20 вовсе.
    expect(formatMoney(25000)).not.toContain(" ");
    expect(formatMoney(25000).codePointAt(2)).toBe(0x00a0);
  });
});

describe("formatDayMonth", () => {
  it("«22 августа» — родительный падеж, без года", () => {
    expect(formatDayMonth("2026-08-22")).toBe("22 августа");
    expect(formatDayMonth("2026-01-01")).toBe("1 января");
  });

  it("непонятную строку отдаёт как есть — врать не о чем", () => {
    expect(formatDayMonth("не дата")).toBe("не дата");
    expect(formatDayMonth("2026-13-01")).toBe("2026-13-01");
  });

  it("несуществующий день месяца — не дата", () => {
    expect(formatDayMonth("2026-02-30")).toBe("2026-02-30");
    expect(formatDayMonth("2026-04-31")).toBe("2026-04-31");
    // А настоящие даты тех же месяцев по-прежнему читаются — иначе тест прошёл бы
    // и на функции, которая отвергает вообще всё.
    expect(formatDayMonth("2026-02-28")).toBe("28 февраля");
    expect(formatDayMonth("2026-04-30")).toBe("30 апреля");
  });
});
