import { describe, it, expect } from "vitest";
import { addDaysIso } from "@planer/shared";
import { Bot } from "grammy";
import { makeTestDb } from "../db/testdb";
import type { Db } from "../db/client";
import { createEmployee, setEmployeeObserver, listActive, linkTelegramAccount } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { handoverCandidates } from "../handover/candidates";
import { teamNow } from "../util/team-time";
import { testConfig } from "../test-config";
import { readTeamSchedule } from "../repo/team-schedule";
import { createSwap } from "../swap/swap-service";
import { createVacantSlot } from "../repo/weekend";
import { expressInterest, interestedForSlot, assignSlot, openSlotsForWorker } from "../weekend/weekend-service";
import { listActiveTemplates } from "../repo/templates";
import { rotationCandidatesFor } from "../repo/template-roles";
import { notifyVacantSlot } from "../bot/notify";
import { recordApi, stubBotInfo } from "../bot/testbot";

const config = testConfig({ adminTelegramIds: [] });
/** Дата командная, не машинная: граница дня не должна зависеть от раннера. */
const day = (offset: number) => addDaysIso(teamNow(config.teamTz).date, offset);

/** Фиксированные даты для выходных-тестов ниже: слот обязан быть субботой/воскресеньем
 *  (`isWeekend`), а `day()` — плавающая дата раннера, под которую подгонять выходной
 *  каждый прогон незачем. Та же пара, что уже используется в weekend.test.ts. */
const WEEKEND_TODAY = "2026-07-01";
const WEEKEND_SLOT = "2026-07-18"; // суббота

/** Наблюдатель, у которого обе галочки-исключения СНЯТЫ: если тест зелёный,
 *  исключает именно роль, а не старое ограничение. */
function observer(db: Db, displayName: string) {
  const person = createEmployee(db, { displayName });
  const withRole = setEmployeeObserver(db, person.id, true)!;
  expect(withRole.excludedFromAssignment).toBe(false);
  expect(withRole.excludedFromSwaps).toBe(false);
  return withRole;
}

describe("наблюдатель вне командной механики", () => {
  it("не предлагается как кандидат на чужую смену", () => {
    const db = makeTestDb();
    const owner = createEmployee(db, { displayName: "Аня" });
    const watcher = observer(db, "Марк");
    const shift = createShift(db, { date: day(2), start: "09:00", end: "18:00", employeeId: owner.id, category: "shift" });

    expect(handoverCandidates(db, shift).map((e) => e.id)).not.toContain(watcher.id);
  });

  it("остаётся в `listActive` — он не в архиве, он просто не работает по графику", () => {
    const db = makeTestDb();
    const watcher = observer(db, "Даша");
    expect(listActive(db).map((e) => e.id)).toContain(watcher.id);
  });

  // `team-schedule.ts:51` — сетка гасит кнопку «Обменять» этим полем, и роль обязана
  // перекрывать снятую галочку так же, как у /api/me (`readTeamSchedule`'s комментарий).
  it("readTeamSchedule отдаёт наблюдателя с excludedFromSwaps: true, даже когда галочка снята", () => {
    const db = makeTestDb();
    const watcher = observer(db, "Марк");
    const view = readTeamSchedule(db, day(0), day(7));
    expect(view.employees.find((e) => e.id === watcher.id)?.excludedFromSwaps).toBe(true);
  });

  // `swap-service.ts:45` — наблюдатель не может ни предложить обмен (инициатор), ни
  // принять его (контрагент); обе стороны идут через одну и ту же `isBlocked`.
  it("createSwap отказывает, когда инициатор или контрагент — наблюдатель", () => {
    const db = makeTestDb();
    const watcher = observer(db, "Игорь");
    const partner = createEmployee(db, { displayName: "Аня" });
    const watcherShift = createShift(db, { date: day(1), start: "08:00", end: "17:00", employeeId: watcher.id, category: "shift" });
    const partnerShift = createShift(db, { date: day(1), start: "11:00", end: "20:00", employeeId: partner.id, category: "shift" });

    expect(createSwap(db, { fromEmployeeId: watcher.id, fromShiftId: watcherShift.id, toShiftId: partnerShift.id }, { date: day(0), time: "07:00" }))
      .toEqual({ ok: false, reason: "from-excluded" });

    const secondWatcherShift = createShift(db, { date: day(2), start: "08:00", end: "17:00", employeeId: watcher.id, category: "shift" });
    expect(createSwap(db, { fromEmployeeId: partner.id, fromShiftId: partnerShift.id, toShiftId: secondWatcherShift.id }, { date: day(0), time: "07:00" }))
      .toEqual({ ok: false, reason: "to-excluded" });
  });

  // `weekend-service.ts:99` — маршрут берёт slotId из тела запроса, поэтому наблюдатель,
  // подставивший его напрямую (в обход пустой вкладки), обязан получить отказ здесь.
  it("expressInterest отказывает наблюдателю", () => {
    const db = makeTestDb();
    const watcher = observer(db, "Марк");
    const slot = createVacantSlot(db, { date: WEEKEND_SLOT, start: "10:00", end: "18:00" });
    expect(expressInterest(db, slot.id, watcher.id, WEEKEND_TODAY)).toEqual({ ok: false, reason: "excluded" });
  });

  // `weekend-service.ts:135` — наблюдатель, успевший «Хочу» до выдачи роли, не должен
  // остаться в ранжированном списке, который видит админ на «Назначить».
  it("interestedForSlot не показывает наблюдателя в ранжированном списке", () => {
    const db = makeTestDb();
    const staying = createEmployee(db, { displayName: "Аня" });
    const person = createEmployee(db, { displayName: "Игорь" });
    const slot = createVacantSlot(db, { date: WEEKEND_SLOT, start: "10:00", end: "18:00" });
    expect(expressInterest(db, slot.id, staying.id, WEEKEND_TODAY).ok).toBe(true);
    expect(expressInterest(db, slot.id, person.id, WEEKEND_TODAY).ok).toBe(true);
    const watcher = setEmployeeObserver(db, person.id, true)!;

    expect(interestedForSlot(db, slot.id).map((i) => i.employeeId)).toEqual([staying.id]);
    expect(interestedForSlot(db, slot.id).map((i) => i.employeeId)).not.toContain(watcher.id);
  });

  // `weekend-service.ts:168` — интерес мог быть записан до выдачи роли (или пришёл
  // прямым вызовом API), и «Назначить» обязан отказать даже при живой строке интереса.
  it("assignSlot отказывает наблюдателю даже при записанном интересе", () => {
    const db = makeTestDb();
    const person = createEmployee(db, { displayName: "Игорь" });
    const slot = createVacantSlot(db, { date: WEEKEND_SLOT, start: "10:00", end: "18:00" });
    expect(expressInterest(db, slot.id, person.id, WEEKEND_TODAY).ok).toBe(true);
    const watcher = setEmployeeObserver(db, person.id, true)!;

    expect(assignSlot(db, slot.id, watcher.id, WEEKEND_TODAY)).toEqual({ ok: false, reason: "excluded" });
  });

  // `weekend-service.ts:336` — вкладка «Выходные» пуста для наблюдателя, не «видна, но
  // недоступна»: то же правило, что уже действует для `excludedFromAssignment`.
  it("openSlotsForWorker не показывает наблюдателю ни одного слота", () => {
    const db = makeTestDb();
    const watcher = observer(db, "Марк");
    createVacantSlot(db, { date: WEEKEND_SLOT, start: "10:00", end: "18:00" });
    expect(openSlotsForWorker(db, watcher.id, WEEKEND_TODAY)).toEqual([]);
  });

  // `template-roles.ts:84` — ★-очередь ротации предлагает наблюдателя следующим,
  // если её не поправить: та же ловушка, что и с `excludedFromAssignment`.
  it("rotationCandidatesFor не предлагает наблюдателя, но оставляет остальных", () => {
    const db = makeTestDb();
    const night = listActiveTemplates(db).find((t) => t.name === "Ночь")!.id;
    const watcher = observer(db, "Игорь");
    const partner = createEmployee(db, { displayName: "Аня" });

    const candidates = rotationCandidatesFor(db, night, day(0));
    expect(candidates.find((c) => c.employeeId === watcher.id)).toBeUndefined();
    expect(candidates.find((c) => c.employeeId === partner.id)).toBeDefined();
  });

  // `notify.ts:229` — веер «нужен человек на выходной» не должен ни писать наблюдателю,
  // ни считать его в `intended`, иначе «дошло до N из M» врёт о том, кого спросили.
  it("notifyVacantSlot пропускает наблюдателя и не считает его в intended", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Аня", inviteToken: "i-111" });
    linkTelegramAccount(db, "i-111", 111);
    const person = createEmployee(db, { displayName: "Игорь", inviteToken: "i-222" });
    linkTelegramAccount(db, "i-222", 222);
    setEmployeeObserver(db, person.id, true);
    const bot = stubBotInfo(new Bot("12345:tok"), { id: 42, first_name: "P", username: "p_bot" });
    const { sent } = recordApi(bot);

    const result = await notifyVacantSlot(bot, db, 1, "Нужен человек на выходной");

    expect(sent.map((s) => s.chat_id)).toEqual([111]);
    expect(result).toEqual({ delivered: 1, intended: 1 });
  });
});
