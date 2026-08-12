import { describe, expect, it } from "vitest";
import { AUDIT_TYPES, HONOUREE_AUDIT_TYPES, auditMonthRange, describeAuditEvent, formatAuditMoment } from "./audit";

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
    expect(titleFor("offsite")).toBe("Добавлено мероприятие");
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

describe("describeAuditEvent — остальные события", () => {
  const cases: { type: string; payload: unknown; title: string; contains: string }[] = [
    {
      type: "distribution_applied",
      payload: { from: "2026-08-03", to: "2026-08-09", count: 37 },
      title: "Смены распределены честно",
      contains: "37",
    },
    {
      type: "roster_import",
      payload: { employeesRenamed: 5, employeesCreated: 21, entriesInserted: 482, unknowns: 1 },
      title: "Загружен график из CSV",
      contains: "482",
    },
    {
      type: "employee_created",
      payload: { employeeId: 9, displayName: "Света Орлова" },
      title: "Добавлен работник",
      contains: "Света Орлова",
    },
    {
      type: "employee_updated",
      payload: {
        employeeId: 9,
        before: { displayName: "Света Орлов", birthDate: null },
        after: { displayName: "Света Орлова", birthDate: "05-08" },
      },
      title: "Изменены данные работника",
      contains: "Света Орлов → Света Орлова",
    },
    {
      type: "employee_reordered",
      payload: { employeeId: 9, displayName: "Света Орлова", from: 3, to: 1 },
      title: "Изменён порядок людей",
      contains: "3 → 1",
    },
    {
      type: "employee_archived",
      payload: { employeeId: 9, displayName: "Света Орлова" },
      title: "Работник архивирован",
      contains: "Света Орлова",
    },
    {
      type: "employee_restored",
      payload: { employeeId: 9, displayName: "Света Орлова" },
      title: "Работник восстановлен",
      contains: "Света Орлова",
    },
    {
      type: "employee_admin_changed",
      payload: { employeeId: 9, displayName: "Света Орлова", isAdmin: true },
      title: "Изменены права админа",
      contains: "теперь админ",
    },
    {
      type: "employee_invite_issued",
      payload: { employeeId: 9, displayName: "Света Орлова", regenerated: true },
      title: "Перевыпущена ссылка-приглашение",
      contains: "Света Орлова",
    },
    {
      type: "settings_changed",
      payload: { employeeId: 9, displayName: "Света Орлова", remindersEnabled: false },
      title: "Работник изменил настройки",
      contains: "напоминания выключены",
    },
    {
      type: "template_roles_changed",
      payload: { templateId: 3, templateName: "Ночь", poolSize: 7, preferred: 2 },
      title: "Изменено «кто что может»",
      contains: "Ночь",
    },
    {
      type: "template_rotation_changed",
      payload: { templateId: 3, templateName: "Ночь", rotationUnit: "week" },
      title: "Изменена очередь",
      contains: "Ночь",
    },
    {
      type: "weekend_slot_created",
      payload: { slotId: 4, slot: "сб 8 авг · 10:00–19:00", delivered: 12, intended: 14 },
      title: "Открыта смена на выходной",
      contains: "12 из 14",
    },
    {
      type: "weekend_assigned",
      payload: { slotId: 4, slot: "сб 8 авг · 10:00–19:00", employeeId: 3, employeeName: "Марк Волков" },
      title: "Выходная смена назначена",
      contains: "Марк Волков",
    },
    {
      type: "weekend_unassigned",
      payload: { slotId: 4, slot: "сб 8 авг · 10:00–19:00", employeeId: 3, employeeName: "Марк Волков" },
      title: "Назначение на выходной снято",
      contains: "Марк Волков",
    },
    {
      type: "weekend_interest",
      payload: { slotId: 4, slot: "сб 8 авг · 10:00–19:00", employeeId: 3, employeeName: "Марк Волков" },
      title: "Отклик на выходную смену",
      contains: "Марк Волков",
    },
    {
      type: "weekend_offer_confirmed",
      payload: { slotId: 4, slot: "сб 8 авг · 10:00–19:00", employeeId: 3, employeeName: "Марк Волков" },
      title: "Выходная смена подтверждена",
      contains: "Марк Волков",
    },
    {
      type: "weekend_offer_declined",
      payload: { slotId: 4, slot: "сб 8 авг · 10:00–19:00", employeeId: 3, employeeName: "Марк Волков" },
      title: "От выходной смены отказались",
      contains: "Марк Волков",
    },
    {
      type: "birthday_sent",
      payload: { employeeId: 2, displayName: "Игорь Петров", delivered: 4, intended: 5 },
      title: "Разослан сбор на день рождения",
      contains: "4 из 5",
    },
    {
      type: "birthday_admin_notice",
      payload: { employeeId: 2, displayName: "Игорь Петров", daysUntil: 7, delivered: 2 },
      title: "Напоминание админам о дне рождения",
      contains: "Игорь Петров",
    },
    {
      type: "birthday_schedule_notice",
      payload: { employeeId: 2, displayName: "Игорь Петров", scheduledSendOn: "2026-08-04", delivered: 2 },
      title: "Напоминание админам о сборе",
      contains: "Игорь Петров",
    },
    {
      type: "birthday_campaign_updated",
      payload: { employeeId: 2, displayName: "Игорь Петров", scheduledSendOn: "2026-08-04" },
      title: "Изменён сбор на день рождения",
      contains: "Игорь Петров",
    },
    {
      type: "reminder_undeliverable",
      payload: { employeeId: 3, displayName: "Марк Волков", shiftId: 88, errorCode: 403 },
      title: "Напоминание не дошло — бот заблокирован",
      contains: "Марк Волков",
    },
    {
      type: "reminders_dispatched",
      payload: { forDate: "2026-08-07", sent: 12, considered: 13 },
      title: "Разосланы напоминания на завтра",
      contains: "12",
    },
  ];

  it.each(cases)("$type говорит «$title»", ({ type, payload, title, contains }) => {
    const view = describeAuditEvent({ type, payload });
    expect(view.title).toBe(title);
    expect(view.lines.join(" · ")).toContain(contains);
    expect(view.lines.join(" ")).not.toContain("undefined");
  });

  it("у события есть иконка, а не только заголовок и строки", () => {
    const view = describeAuditEvent({
      type: "distribution_applied",
      payload: { from: "2026-08-03", to: "2026-08-09", count: 37 },
    });
    expect(view.icon).toBe("⚖");
  });

  it("переводит rotationUnit на русский, а не показывает английский enum как есть", () => {
    const rotationLineFor = (rotationUnit: string) =>
      describeAuditEvent({
        type: "template_rotation_changed",
        payload: { templateId: 3, templateName: "Ночь", rotationUnit },
      }).lines.join(" · ");
    expect(rotationLineFor("week")).toContain("шаг: по неделям");
    expect(rotationLineFor("day")).toContain("шаг: по дням");
  });

  it("описывает закрытие и открытие обменов", () => {
    const closed = describeAuditEvent({
      type: "swaps_lock_changed",
      payload: { locked: true, cancelled: 3, delivered: 24, intended: 26 },
    });
    expect(closed.title).toBe("Обмены смен закрыты");
    expect(closed.lines).toContain("отменено заявок: 3");
    expect(closed.lines).toContain("дошло до 24 из 26");

    const opened = describeAuditEvent({ type: "swaps_lock_changed", payload: { locked: false, cancelled: 0, delivered: 26, intended: 26 } });
    expect(opened.title).toBe("Обмены смен открыты");
    // Открытие ничего не гасит — строки про заявки быть не должно.
    expect(opened.lines.some((line) => line.startsWith("отменено"))).toBe(false);
  });
});

describe("describeAuditEvent — ограничения работника", () => {
  it("описывает изменение ограничений работника", () => {
    const view = describeAuditEvent({
      type: "employee_restrictions_changed",
      payload: {
        employeeId: 4, displayName: "Аня Смирнова",
        before: { excludedFromAssignment: false, excludedFromSwaps: false },
        after: { excludedFromAssignment: true, excludedFromSwaps: false },
      },
    });
    expect(view.title).toBe("Изменены ограничения работника");
    expect(view.lines).toContain("Аня Смирнова");
    expect(view.lines).toContain("назначения: участвует → не участвует");
    // Обмены не менялись — строки про них быть не должно.
    expect(view.lines.some((line) => line.startsWith("обмены"))).toBe(false);
  });
});

describe("события сборов", () => {
  it("«создан сбор» называет повод, а не идентификатор", () => {
    const view = describeAuditEvent({
      type: "collection_created",
      payload: { collectionId: 4, title: "Кофемашина", personName: null },
    });
    expect(view.title).toBe("Заведён сбор");
    expect(view.lines[0]).toBe("Кофемашина");
  });

  it("«разослан сбор» отличает первую рассылку от напоминания", () => {
    const first = describeAuditEvent({
      type: "collection_sent",
      payload: { title: "Кофемашина", round: 1, delivered: 12, intended: 14 },
    });
    expect(first.title).toBe("Разослан сбор");
    expect(first.lines).toContain("доставлено 12 из 14");

    const again = describeAuditEvent({
      type: "collection_sent",
      payload: { title: "Кофемашина", round: 3, delivered: 9, intended: 14 },
    });
    expect(again.title).toBe("Напоминание о сборе");
    expect(again.lines).toContain("рассылка №3");
  });

  it("«закрыт» и «открыт заново» — разные заголовки", () => {
    expect(describeAuditEvent({ type: "collection_closed", payload: { title: "Кофемашина", closed: true } }).title)
      .toBe("Сбор закрыт");
    expect(describeAuditEvent({ type: "collection_closed", payload: { title: "Кофемашина", closed: false } }).title)
      .toBe("Сбор открыт заново");
  });

  it("список типов виновника не пуст и состоит из существующих типов", () => {
    expect(HONOUREE_AUDIT_TYPES.length).toBeGreaterThan(0);
    for (const type of HONOUREE_AUDIT_TYPES) expect(AUDIT_TYPES).toContain(type);
  });
});

describe("describeAuditEvent — полнота таблицы", () => {
  // Настоящая проверка полноты: не сравнение двух списков, набранных руками
  // в этом файле, а прогон через саму `describeAuditEvent`. Тип без описателя
  // проваливается в запасной вариант, где `title === type` — сырой строкой
  // типа события. Ни у одного настоящего описателя заголовок не совпадает
  // со своим типом (все заголовки — русские фразы, все типы — snake_case),
  // так что это надёжный сигнал «описателя нет».
  it.each(AUDIT_TYPES)("%s описан, а не проваливается в запасной вариант", (type) => {
    expect(describeAuditEvent({ type, payload: {} }).title).not.toBe(type);
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

  it("незнакомый тип без payload всё равно отдаёт строки, а не JS-значение undefined", () => {
    const view = describeAuditEvent({ type: "something_added_later", payload: undefined });
    expect(view.lines).toHaveLength(1);
    expect(typeof view.lines[0]).toBe("string");
    expect(view.lines[0]).toBe("null");
  });

  it("на старой записи без имени называет работника номером", () => {
    const view = describeAuditEvent({
      type: "entry_created",
      payload: { entryId: 1, employeeId: 24, date: "2026-08-12", endDate: null, category: "shift", title: "День", start: "09:00", end: "18:00" },
    });
    expect(view.lines[0]).toBe("работник #24 · ср 12 августа");
  });

  it("на старой записи employee_updated без before/after просто называет человека", () => {
    // Живые строки в базе до бэкфилла: плоский payload без before/after —
    // ни одна из трёх диффовых строк не соберётся, и describer падает на personLabel.
    const view = describeAuditEvent({
      type: "employee_updated",
      payload: { employeeId: 9, displayName: "Света Орлова", birthDate: "05-08" },
    });
    expect(view.title).toBe("Изменены данные работника");
    expect(view.lines).toEqual(["Света Орлова"]);
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

describe("auditMonthRange", () => {
  it("для даты в середине месяца отдаёт его первый и последний день", () => {
    expect(auditMonthRange("2026-08-15")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("не обрезает 31-дневный месяц", () => {
    expect(auditMonthRange("2026-01-01")).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("не обрезает 30-дневный месяц", () => {
    expect(auditMonthRange("2026-04-30")).toEqual({ from: "2026-04-01", to: "2026-04-30" });
  });

  it("февраль невисокосного года — 28 дней", () => {
    expect(auditMonthRange("2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("самозапись работника в журнале", () => {
  const payload = {
    entryId: 7,
    employeeId: 3,
    employeeName: "Аня",
    date: "2026-08-12",
    endDate: "2026-08-14",
    category: "sick_leave",
    title: null,
    start: null,
    end: null,
  };

  it("читается как отдельное событие, а не как админская правка", () => {
    const self = describeAuditEvent({ type: "self_entry_created", payload });
    const byAdmin = describeAuditEvent({ type: "entry_created", payload });
    expect(self.title).not.toBe(byAdmin.title);
    expect(self.title.toLowerCase()).toContain("сам");
  });

  it("называет человека и срок", () => {
    const view = describeAuditEvent({ type: "self_entry_created", payload });
    expect(view.lines.join(" ")).toContain("Аня");
    expect(view.lines.join(" ")).toContain("12 авг");
  });

  it("правка показывает, что стало", () => {
    const view = describeAuditEvent({
      type: "self_entry_updated",
      payload: { before: payload, after: { ...payload, endDate: "2026-08-16" } },
    });
    expect(view.lines.join(" ")).toContain("16 авг");
  });

  it("снятие описано, а не падает в сырой JSON", () => {
    const view = describeAuditEvent({ type: "self_entry_deleted", payload });
    expect(view.title).not.toBe("self_entry_deleted");
    expect(view.lines.join(" ")).toContain("Аня");
  });
});
