import { ASSIGN_REFUSAL_TEXT, entryLineOf } from "@planer/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  employeesMock,
  mockAssignSlot,
  mockCloseSlot,
  mockPostSlot,
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
  // Слоты мока стоят на днях текущей недели; в воскресенье субботний был бы уже
  // «прошедшим». Часы ставятся на среду недели слота — тест не зависит от дня запуска.
  async function onWednesdayOf(slotId: number): Promise<string> {
    const date = (await mockGetWeekendSlots()).find((s) => s.slot.id === slotId)!.slot.date;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${date}T12:00:00Z`).getTime() - 3 * 86_400_000);
    return date;
  }
  afterEach(() => {
    vi.useRealTimers();
  });

  it("занятому отказывает фразой сервера — с той же строкой записи — и не ставит его на слот", async () => {
    // Своя запись, а не сид: тесты выше правят общий массив записей. Ночь с
    // пятницы 22:00–11:00 заходит в слот 201 (10:00–18:00).
    const date = await onWednesdayOf(201);
    const friday = new Date(`${date}T00:00:00Z`);
    friday.setUTCDate(friday.getUTCDate() - 1);
    const fridayIso = friday.toISOString().slice(0, 10);
    const { entry } = await mockCreateEntry({ date: fridayIso, start: "22:00", end: "11:00", category: "shift", employeeId: 2 });
    try {
      await expect(mockAssignSlot(201, 2)).rejects.toThrow(
        `в это время уже занят(а): ${entryLineOf({ ...entry, title: entry.title ?? null })}`,
      );
      const after = (await mockGetWeekendSlots()).find((s) => s.slot.id === 201)!;
      expect(after.assignees.map((a) => a.employeeId)).not.toContain(2);
    } finally {
      await mockDeleteEntry(entry.id);
    }
  });

  it("назначение ставит запись «работа в выходной» в график, снятие — убирает; отпуск не мешает", async () => {
    // Отпуск Марка (3) на этот день — пометка, а не запрет (решение 2026-07-30).
    const date = await onWednesdayOf(201);
    const { entry: vacation } = await mockCreateEntry({ date, category: "vacation", employeeId: 3 });
    try {
      await mockAssignSlot(201, 3);
      const view = (await mockGetWeekendSlots()).find((s) => s.slot.id === 201)!;
      const mine = view.assignees.find((a) => a.employeeId === 3)!;
      expect(mine).toBeDefined();
      const work = (await mockGetTeamSchedule(date, date)).filter((s) => s.employeeId === 3 && s.category === "weekend_work");
      expect(work).toHaveLength(1);
      expect(work[0]).toMatchObject({ date, start: view.slot.start, end: view.slot.end, title: view.slot.title ?? "Работа в выходной" });

      await mockUnassignSlot(mine.assignmentId);
      expect((await mockGetTeamSchedule(date, date)).filter((s) => s.employeeId === 3 && s.category === "weekend_work")).toHaveLength(0);
    } finally {
      await mockDeleteEntry(vacation.id);
    }
  });

  it("отказы — те же фразы, что у сервера", async () => {
    await onWednesdayOf(201);
    await expect(mockAssignSlot(999_999, 2)).rejects.toThrow(ASSIGN_REFUSAL_TEXT.not_found);
    // Даша (4) не откликалась на слот 201.
    await expect(mockAssignSlot(201, 4)).rejects.toThrow(ASSIGN_REFUSAL_TEXT.not_interested);

    await employeesMock.setEmployeeRestrictions(2, { excludedFromAssignment: true });
    try {
      await expect(mockAssignSlot(201, 2)).rejects.toThrow(ASSIGN_REFUSAL_TEXT.excluded);
    } finally {
      await employeesMock.setEmployeeRestrictions(2, { excludedFromAssignment: false });
    }

    await employeesMock.archiveEmployee(2);
    try {
      await expect(mockAssignSlot(201, 2)).rejects.toThrow(ASSIGN_REFUSAL_TEXT.not_active);
    } finally {
      await employeesMock.restoreEmployee(2);
    }

    // Неделей позже слот уже прошёл.
    vi.setSystemTime(Date.now() + 7 * 86_400_000);
    await expect(mockAssignSlot(201, 2)).rejects.toThrow(ASSIGN_REFUSAL_TEXT.slot_passed);
  });

  it("закрытый слот — «набор закрыт»", async () => {
    const posted = await mockPostSlot({ date: "2099-03-07", start: "10:00", end: "18:00" });
    await mockCloseSlot(posted.id);
    await expect(mockAssignSlot(posted.id, 2)).rejects.toThrow(ASSIGN_REFUSAL_TEXT.not_open);
  });
});
