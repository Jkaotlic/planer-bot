import { describe, it, expect } from "vitest";
import {
  collectionMessage,
  collectionStatus,
  collectionTitle,
  compareCollections,
  formatDayMonth,
  formatMoney,
  isCollectionActive,
  type CollectionShape,
  type CollectionSortable,
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

describe("collectionTitle", () => {
  it("у кастомного сбора — его повод", () => {
    expect(collectionTitle({ kind: "custom", title: "Кофемашина" }, null)).toBe("Кофемашина");
    expect(collectionTitle({ kind: "custom", title: "Свадьба" }, "Пётр Иванов")).toBe("Свадьба");
  });

  it("у дня рождения — имя в именительном через тире", () => {
    expect(collectionTitle({ kind: "birthday", title: null }, "Пётр Иванов")).toBe("День рождения — Пётр Иванов");
  });

  it("у дня рождения без имени не падает", () => {
    expect(collectionTitle({ kind: "birthday", title: null }, null)).toBe("День рождения");
  });
});

describe("collectionMessage", () => {
  const wedding = {
    kind: "custom" as const,
    title: "Свадьба",
    personName: "Пётр Иванов",
    birthDateLabel: null,
    eventDate: "2026-08-22",
    deadline: "2026-08-15",
    amountPerPerson: 1000,
    totalGoal: 25000,
    collectUrl: "https://example.test/c/1",
  };

  it("собирает первое сообщение из заполненных полей", () => {
    expect(collectionMessage(wedding, "first")).toBe(
      [
        "🎁 Свадьба — Пётр Иванов, 22 августа",
        "",
        "Скидываемся по 1 000 ₽, нужно 25 000 ₽",
        "Скиньтесь до 15 августа.",
        "",
        "Сбор: https://example.test/c/1",
        "",
        "Ссылка всегда есть в мини-приложении, вкладка «Команда».",
      ].join("\n"),
    );
  });

  it("общий сбор без виновника — другой значок и без имени", () => {
    const text = collectionMessage(
      { ...wedding, title: "Кофемашина в офис", personName: null, eventDate: null, deadline: null, totalGoal: null },
      "first",
    );
    expect(text.split("\n")[0]).toBe("💰 Кофемашина в офис");
    expect(text).toContain("Скидываемся по 1 000 ₽");
    expect(text).not.toContain("нужно");
    expect(text).not.toContain("Скиньтесь до");
  });

  it("дожим отличается только первой строкой", () => {
    const first = collectionMessage(wedding, "first").split("\n");
    const again = collectionMessage(wedding, "reminder").split("\n");
    expect(again[0]).toBe("⏰ Напоминаю про сбор: Свадьба — Пётр Иванов, 22 августа");
    expect(again.slice(1)).toEqual(first.slice(1));
  });

  it("одна только цель пишется с большой буквы", () => {
    const text = collectionMessage({ ...wedding, amountPerPerson: null }, "first");
    expect(text).toContain("Нужно 25 000 ₽");
    expect(text).not.toContain("Скидываемся");
  });

  it("пустой сбор — одна строка заголовка и ничего лишнего", () => {
    const text = collectionMessage(
      { kind: "custom", title: "Просто сбор", personName: null, birthDateLabel: null, eventDate: null, deadline: null, amountPerPerson: null, totalGoal: null, collectUrl: null },
      "first",
    );
    expect(text).toBe("💰 Просто сбор");
  });

  it("день рождения сохраняет текст, который он уже утвердил, слово в слово", () => {
    const text = collectionMessage(
      {
        kind: "birthday", title: null, personName: "Пётр Иванов", birthDateLabel: "08-05",
        eventDate: "2026-08-05", deadline: null, amountPerPerson: null, totalGoal: null,
        collectUrl: "https://example.test/c/1",
      },
      "first",
    );
    expect(text).toBe("🎂 Пётр Иванов празднует день рождения 5 августа.\n\nСбор на подарок: https://example.test/c/1");
  });

  it("день рождения без ссылки — одна строка, и суммы в него не лезут", () => {
    const text = collectionMessage(
      {
        kind: "birthday", title: null, personName: "Пётр Иванов", birthDateLabel: "08-05",
        eventDate: null, deadline: "2026-08-04", amountPerPerson: 1000, totalGoal: null, collectUrl: null,
      },
      "first",
    );
    expect(text).toBe("🎂 Пётр Иванов празднует день рождения 5 августа.");
  });
});

describe("compareCollections", () => {
  const today = "2026-08-10";
  const base = {
    kind: "custom" as const, employeeId: null, celebratedOn: null, eventDate: null,
    amountPerPerson: null, totalGoal: null, collectUrl: null, closedAt: null, sendCount: 0,
  };
  const row = (title: string, patch: Record<string, unknown>) =>
    ({ ...base, title, deadline: null, createdAt: "2026-08-01T00:00:00Z", ...patch }) as CollectionSortable;

  it("активные впереди закрытых, даже если закрытый ближе по дате", () => {
    const closed = row("Закрытый", { deadline: "2026-08-11", closedAt: "2026-08-09T00:00:00Z" });
    const open = row("Открытый", { deadline: "2026-12-31" });
    expect([closed, open].sort((a, b) => compareCollections(a, b, today)).map((c) => c.title))
      .toEqual(["Открытый", "Закрытый"]);
  });

  it("внутри активных — по ближайшей дате, бездатные в конце", () => {
    const far = row("Далёкий", { deadline: "2026-12-01" });
    const near = row("Близкий", { deadline: "2026-08-12" });
    const noDate = row("Бездатный", {});
    expect([noDate, far, near].sort((a, b) => compareCollections(a, b, today)).map((c) => c.title))
      .toEqual(["Близкий", "Далёкий", "Бездатный"]);
  });

  it("внутри закрытых — новые сверху", () => {
    const older = row("Старый", { closedAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" });
    const newer = row("Новый", { closedAt: "2026-08-01T00:00:00Z", createdAt: "2026-08-01T00:00:00Z" });
    expect([older, newer].sort((a, b) => compareCollections(a, b, today)).map((c) => c.title))
      .toEqual(["Новый", "Старый"]);
  });
});
