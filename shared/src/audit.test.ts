import { describe, expect, it } from "vitest";
import { describeAuditEvent, formatAuditMoment } from "./audit";

describe("describeAuditEvent — записи", () => {
  it("рассказывает, кому и на какой день поставили смену", () => {
    const view = describeAuditEvent({
      type: "entry_created",
      payload: {
        entryId: 979, employeeId: 24, employeeName: "Марк Волков", date: "2026-08-12",
        endDate: null, category: "shift", title: "День", start: "09:00", end: "18:00",
      },
    });
    expect(view.title).toBe("Добавлена смена");
    expect(view.lines).toEqual(["Марк Волков · ср 12 августа", "День 09:00–18:00"]);
  });

  it("называет отпуск отпуском и показывает его размах", () => {
    const view = describeAuditEvent({
      type: "entry_created",
      payload: {
        entryId: 980, employeeId: 24, employeeName: "Марк Волков", date: "2026-08-12",
        endDate: "2026-08-20", category: "vacation", title: null, start: null, end: null,
      },
    });
    expect(view.title).toBe("Добавлен отпуск");
    expect(view.lines).toEqual(["Марк Волков · ср 12 августа — чт 20 августа", "Весь день"]);
  });

  it("согласует род с категорией, а не с последней буквой", () => {
    const base = {
      entryId: 981, employeeId: 24, employeeName: "Марк Волков", date: "2026-08-12",
      endDate: null, title: null, start: null, end: null,
    };
    const titleFor = (category: string) =>
      describeAuditEvent({ type: "entry_created", payload: { ...base, category } }).title;
    expect(titleFor("shift")).toBe("Добавлена смена");
    expect(titleFor("vacation")).toBe("Добавлен отпуск");
    expect(titleFor("duty")).toBe("Добавлено дежурство");
    expect(titleFor("weekend_work")).toBe("Добавлена работа в выходной");
    expect(titleFor("offsite")).toBe("Добавлено выездное мероприятие");
  });

  it("на правке показывает только то, что действительно изменилось", () => {
    const before = {
      entryId: 979, employeeId: 24, employeeName: "Марк Волков", date: "2026-08-12",
      endDate: null, category: "shift", title: null, start: null, end: null,
    };
    const view = describeAuditEvent({
      type: "entry_updated",
      payload: { before, after: { ...before, title: "День", start: "09:00", end: "18:00" } },
    });
    expect(view.title).toBe("Изменена смена");
    expect(view.lines).toEqual([
      "Марк Волков · ср 12 августа",
      "было: Весь день",
      "стало: День 09:00–18:00",
    ]);
  });

  it("на смене работника называет обоих", () => {
    const before = {
      entryId: 979, employeeId: 24, employeeName: "Марк Волков", date: "2026-08-12",
      endDate: null, category: "shift", title: "День", start: "09:00", end: "18:00",
    };
    const view = describeAuditEvent({
      type: "entry_updated",
      payload: { before, after: { ...before, employeeId: 25, employeeName: "Олег Соколов" } },
    });
    expect(view.lines).toContain("работник: Марк Волков → Олег Соколов");
  });

  it("удаление показывает, что именно исчезло", () => {
    const view = describeAuditEvent({
      type: "entry_deleted",
      payload: {
        entryId: 979, employeeId: 24, employeeName: "Марк Волков", date: "2026-08-12",
        endDate: null, category: "shift", title: "День", start: "09:00", end: "18:00",
      },
    });
    expect(view.title).toBe("Удалена смена");
    expect(view.lines).toEqual(["Марк Волков · ср 12 августа", "День 09:00–18:00"]);
  });
});

describe("describeAuditEvent — обмены", () => {
  const swap = {
    requestId: 12,
    fromEmployeeId: 2, fromName: "Аня Смирнова", fromShift: "пн 10 авг · Утро 09:00–18:00",
    toEmployeeId: 3, toName: "Марк Волков", toShift: "ср 12 авг · День 09:00–18:00",
  };

  it("показывает обе стороны обмена", () => {
    const view = describeAuditEvent({ type: "swap_accepted", payload: swap });
    expect(view.title).toBe("Обмен состоялся");
    expect(view.lines).toEqual([
      "Аня Смирнова отдаёт: пн 10 авг · Утро 09:00–18:00",
      "Марк Волков отдаёт: ср 12 авг · День 09:00–18:00",
    ]);
  });

  it("у каждого исхода обмена своя формулировка", () => {
    const titles = (["swap_proposed", "swap_declined", "swap_cancelled", "swap_expired", "swap_auto_cancelled"] as const)
      .map((type) => describeAuditEvent({ type, payload: swap }).title);
    expect(new Set(titles).size).toBe(5);
  });
});

describe("describeAuditEvent — незнакомое и битое", () => {
  it("не прячет событие, которого не знает", () => {
    const view = describeAuditEvent({ type: "something_added_later", payload: { a: 1 } });
    expect(view.title).toBe("something_added_later");
    expect(view.lines.join("")).toContain("\"a\": 1");
  });

  it("переживает payload не той формы, без undefined в тексте", () => {
    const view = describeAuditEvent({ type: "entry_created", payload: null });
    expect(view.lines.join(" ")).not.toContain("undefined");
  });

  it("на старой записи без имени называет работника номером", () => {
    const view = describeAuditEvent({
      type: "entry_created",
      payload: { entryId: 1, employeeId: 24, date: "2026-08-12", endDate: null, category: "shift", title: "День", start: "09:00", end: "18:00" },
    });
    expect(view.lines[0]).toBe("работник #24 · ср 12 августа");
  });
});

describe("formatAuditMoment", () => {
  it("ставит дату вперёд времени — журнал читают по «когда»", () => {
    expect(formatAuditMoment("2026-08-05T14:32:00.000Z")).toMatch(/5 августа/);
  });

  it("возвращает вход как есть, если это не дата", () => {
    expect(formatAuditMoment("не дата")).toBe("не дата");
  });
});
