import { describe, expect, it } from "vitest";
import {
  employeesMock,
  mockAssignSlot,
  mockUnassignSlot,
  mockGetWeekendSlots,
  mockCreateEntry,
  mockCreateEntryRange,
  mockDeleteEntry,
  mockGetTeamSchedule,
  TEMPLATES,
  mockCreateCollection,
  mockGetCollectionPayments,
  mockSetCollectionPaymentFor,
  mockRemindUnpaid,
  mockGetCollections,
  mockGetCollectionPreview,
  mockSendCollection,
  mockGetBirthdayPreview,
  mockSaveBirthdayRound,
  mockSetCollectionClosed,
  mockGetSickApprovals,
  mockApproveSickLeave,
} from "./mock";

describe("admin schedule mock", () => {
  it("mirrors the renamed 07:00 duty preset used by the real API", () => {
    expect(TEMPLATES.find((template) => template.id === 6)).toMatchObject({
      id: 6,
      name: "Дежурство с 07:00",
      category: "duty",
      accent: "amber",
      start: "07:00",
      end: "16:00",
      fridayStart: "07:00",
      fridayEnd: "14:45",
    });
  });
});

describe("мок сборов", () => {
  it("отдаёт заведённый сбор в списке и в предпросмотре", async () => {
    const created = await mockCreateCollection({ title: "Кофемашина", amountPerPerson: 1000 });
    const rows = await mockGetCollections();
    expect(rows.map((r) => r.title)).toContain("Кофемашина");

    const preview = await mockGetCollectionPreview(created.id);
    expect(preview.message).toContain("Скидываемся по 1 000 ₽");
    expect(preview.blocker).toContain("Нет ссылки");
  });

  it("после рассылки кастомный сбор можно дожать, а ДР нельзя", async () => {
    const created = await mockCreateCollection({ title: "Кофемашина", collectUrl: "https://example.test/c/1" });
    await mockSendCollection(created.id);
    expect((await mockGetCollectionPreview(created.id)).blocker).toBeNull();
    expect((await mockGetCollectionPreview(created.id)).sendCount).toBe(1);

    // Вторая половина названия теста: раунд ДР после рассылки — наоборот,
    // дожать нельзя. id 2 — «Игорь Петров», у него есть дата рождения в
    // фикстуре, и это не viewer консоли (им становится первый isAdmin &&
    // isActive — id 1, «Аня Смирнова»), так что сюрприз-правило его не тронет.
    const BIRTHDAY_EMPLOYEE_ID = 2;
    const round = await mockSaveBirthdayRound(BIRTHDAY_EMPLOYEE_ID, { collectUrl: "https://example.test/dr" });
    expect((await mockGetBirthdayPreview(BIRTHDAY_EMPLOYEE_ID)).blocker).toBeNull();

    await mockSendCollection(round.id);
    expect((await mockGetBirthdayPreview(BIRTHDAY_EMPLOYEE_ID)).blocker).toBe("Уже разослано — повторная отправка отключена.");
  });

  // Мок повторяет условия сервера (`arming` в app.ts): `armAutoSend` не
  // вооружает разосланный или закрытый раунд, а молча ничего не пишет — иначе
  // DEV-мок расходился бы с проверенным сервером, и этот баг проверялся бы
  // только руками.
  it("armAutoSend не вооружает закрытый раунд ДР", async () => {
    // id 4 — «Даша Кузнецова», своя дата рождения, ещё не занята другим тестом
    // в этом файле (id 2 уже разослан выше, тот же модуль хранит состояние).
    const BIRTHDAY_EMPLOYEE_ID = 4;
    const created = await mockSaveBirthdayRound(BIRTHDAY_EMPLOYEE_ID, { collectUrl: "https://example.test/dr", autoSendOn: null });
    await mockSetCollectionClosed(created.id, true);

    const after = await mockSaveBirthdayRound(BIRTHDAY_EMPLOYEE_ID, { armAutoSend: true });
    expect(after.autoSendOn).toBeNull();
  });

  it("сюрприз-правило: свой сбор не виден в списке и не открывается по id — чужой виден", async () => {
    // Viewer DEV-консоли — первый isAdmin && isActive в фикстуре: id 1, «Аня Смирнова».
    const VIEWER_EMPLOYEE_ID = 1;
    const hidden = await mockCreateCollection({ title: "Секретный сбор", employeeId: VIEWER_EMPLOYEE_ID });
    const visible = await mockCreateCollection({ title: "Открытый сбор" });

    const rows = await mockGetCollections();
    expect(rows.some((r) => r.collection.id === hidden.id)).toBe(false);
    expect(rows.some((r) => r.collection.id === visible.id)).toBe(true);

    await expect(mockGetCollectionPreview(hidden.id)).rejects.toThrow("not_found");
  });

  it("без активного админа в фикстуре общий сбор всё равно виден", async () => {
    // Общий сбор хранит employeeId: null — то же самое значение, которым
    // viewerEmployeeId() метил «нет активного админа» до фикса. Если бы
    // сравнение снова свелось к null === null, этот сбор исчез бы из списка
    // и 404-ил бы по id, хотя виновника у него нет вообще.
    // id 1 — «Аня Смирнова», единственный isAdmin в фикстуре.
    await employeesMock.setEmployeeAdmin(1, false);
    try {
      const visible = await mockCreateCollection({ title: "Без виновника" });
      const rows = await mockGetCollections();
      expect(rows.some((r) => r.collection.id === visible.id)).toBe(true);
      const preview = await mockGetCollectionPreview(visible.id);
      expect(preview.id).toBe(visible.id);
    } finally {
      await employeesMock.setEmployeeAdmin(1, true);
    }
  });
});

describe("мок отметок о сдаче", () => {
  it("ведёт себя как сервер: галочка ставится, счёт растёт, дожим уходит ждущим", async () => {
    const round = await mockCreateCollection({
      title: "Кофемашина", employeeId: null, eventDate: null, deadline: null,
      amountPerPerson: 500, totalGoal: null, collectUrl: "https://example.test/c/1",
      messageText: null, scheduledSendOn: null,
    });

    const before = await mockGetCollectionPayments(round.id);
    const waiting = before.rows.filter((r) => !r.paid).length;
    expect(waiting).toBeGreaterThan(0);

    const after = await mockSetCollectionPaymentFor(round.id, before.rows.find((r) => !r.paid)!.employeeId, true);
    expect(after.paidCount).toBe(before.paidCount + 1);

    const remind = await mockRemindUnpaid(round.id);
    expect(remind.intended).toBe(waiting - 1);
  });
});

describe("демо «На подтверждение»", () => {
  it("ждущий больничный виден в «На подтверждение», ОК снимает его из списка", async () => {
    const before = await mockGetSickApprovals();
    expect(before.length).toBeGreaterThan(0);
    await mockApproveSickLeave(before[0]!.id);
    expect((await mockGetSickApprovals()).map((r) => r.id)).not.toContain(before[0]!.id);
  });
});

/** Замена отсутствия диапазоном — так же, как сервер (см. entries-range.test.ts). */
describe("мок консоли: диапазон с заменой отсутствия", () => {
  it("день посреди отпуска: смена встаёт, отпуск делится; без флага — пропуск", async () => {
    // 2099-03-02 — понедельник, 06-е — пятница.
    const { entry } = await mockCreateEntry({ date: "2099-03-02", endDate: "2099-03-06", category: "vacation", employeeId: 1 });
    const vacations = async () =>
      (await mockGetTeamSchedule("2099-03-01", "2099-03-08")).filter((s) => s.employeeId === 1 && s.category === "vacation");
    try {
      const kept = await mockCreateEntryRange({
        employeeId: 1, from: "2099-03-04", to: "2099-03-04", category: "shift", start: "09:00", end: "18:00", mode: "rewrite",
      });
      expect(kept.skipped).toEqual([{ date: "2099-03-04", reason: "absence" }]);

      const result = await mockCreateEntryRange({
        employeeId: 1, from: "2099-03-04", to: "2099-03-04", category: "shift", start: "09:00", end: "18:00",
        mode: "rewrite", replaceAbsences: true,
      });
      expect(result.created.map((s) => s.date)).toEqual(["2099-03-04"]);
      expect(result.replacedAbsence).toEqual(["2099-03-04"]);
      expect((await vacations()).map((s) => ({ date: s.date, endDate: s.endDate }))).toEqual([
        { date: "2099-03-02", endDate: "2099-03-03" },
        { date: "2099-03-05", endDate: "2099-03-06" },
      ]);
    } finally {
      const left = (await mockGetTeamSchedule("2099-03-01", "2099-03-08")).filter((s) => s.employeeId === 1);
      await Promise.all([entry.id, ...left.map((s) => s.id)].map((id) => mockDeleteEntry(id)));
    }
  });
});

/** Замена одного отсутствия — так же, как сервер (entries-range.test.ts). */
describe("мок консоли: диапазон с заменой одного отсутствия", () => {
  it("режет только названный отпуск, второй пропущен по отсутствию; чужой — ошибка", async () => {
    // 2099-03-02 — понедельник, 06-е — пятница.
    const { entry: first } = await mockCreateEntry({ date: "2099-03-02", endDate: "2099-03-03", category: "vacation", employeeId: 1 });
    const { entry: second } = await mockCreateEntry({ date: "2099-03-05", endDate: "2099-03-06", category: "vacation", employeeId: 1 });
    const { entry: foreign } = await mockCreateEntry({ date: "2099-03-02", category: "vacation", employeeId: 2 });
    try {
      await expect(mockCreateEntryRange({
        employeeId: 1, from: "2099-03-02", to: "2099-03-06", category: "shift", start: "09:00", end: "18:00",
        mode: "rewrite", replaceAbsenceEntryId: foreign.id,
      })).rejects.toThrow("Заменяемое отсутствие принадлежит другому человеку");

      const result = await mockCreateEntryRange({
        employeeId: 1, from: "2099-03-02", to: "2099-03-06", category: "shift", start: "09:00", end: "18:00",
        mode: "rewrite", replaceAbsenceEntryId: first.id,
      });
      expect(result.created.map((s) => s.date)).toEqual(["2099-03-02", "2099-03-03", "2099-03-04"]);
      expect(result.skipped.map((s) => s.reason)).toEqual(["absence", "absence"]);
      const left = (await mockGetTeamSchedule("2099-03-01", "2099-03-08"))
        .filter((s) => s.employeeId === 1 && s.category === "vacation").map((s) => s.id);
      expect(left).toEqual([second.id]);
    } finally {
      const left = (await mockGetTeamSchedule("2099-03-01", "2099-03-08")).filter((s) => s.employeeId === 1 || s.employeeId === 2);
      await Promise.all(left.filter((s) => s.date >= "2099-03-01").map((s) => mockDeleteEntry(s.id)));
    }
  });
});

describe("назначение на выходной в dev-моке — как сервер", () => {
  it("занятому отказывает фразой сервера и не ставит его на слот", async () => {
    // Своя запись, а не сид: тесты выше правят общий массив записей, и на
    // субботнюю смену из сида здесь полагаться нельзя. Ночь с пятницы 22:00–11:00
    // заходит в слот 201 (10:00–18:00) — та же ночь накануне, что у сервера.
    const view = (await mockGetWeekendSlots()).find((s) => s.slot.id === 201)!;
    const friday = new Date(`${view.slot.date}T00:00:00Z`);
    friday.setUTCDate(friday.getUTCDate() - 1);
    const { entry } = await mockCreateEntry({
      date: friday.toISOString().slice(0, 10), start: "22:00", end: "11:00", category: "shift", employeeId: 4,
    });
    try {
      await expect(mockAssignSlot(201, 4)).rejects.toThrow(/^.+ в это время уже занят\(а\): .*22:00–11:00/);
      const after = (await mockGetWeekendSlots()).find((s) => s.slot.id === 201)!;
      expect(after.assignees.map((a) => a.employeeId)).not.toContain(4);
    } finally {
      await mockDeleteEntry(entry.id);
    }
  });

  it("отпуск — пометка, а не запрет: человека в отпуске назначает", async () => {
    // У Марка (3) в субботу смен нет; отпуск на этот день решение 2026-07-30
    // считает пометкой («иногда человек сам просит выйти из отпуска»).
    const view = (await mockGetWeekendSlots()).find((s) => s.slot.id === 201)!;
    const { entry } = await mockCreateEntry({ date: view.slot.date, category: "vacation", employeeId: 3 });
    try {
      await mockAssignSlot(201, 3);
      const after = (await mockGetWeekendSlots()).find((s) => s.slot.id === 201)!;
      const mine = after.assignees.find((a) => a.employeeId === 3)!;
      expect(mine).toBeDefined();
      await mockUnassignSlot(mine.assignmentId);
    } finally {
      await mockDeleteEntry(entry.id);
    }
  });
});
