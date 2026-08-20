import { describe, it, expect } from "vitest";
import { addDaysIso } from "@planer/shared";
import { makeTestDb } from "../db/testdb";
import type { Db } from "../db/client";
import { createEmployee, setEmployeeObserver, listActive } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { buildDistribution } from "./distribute-service";
import { handoverCandidates } from "../handover/candidates";
import { teamNow } from "../util/team-time";
import { testConfig } from "../test-config";

const config = testConfig({ adminTelegramIds: [] });
/** Дата командная, не машинная: граница дня не должна зависеть от раннера. */
const day = (offset: number) => addDaysIso(teamNow(config.teamTz).date, offset);

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
  it("не попадает в честную раздачу", () => {
    const db = makeTestDb();
    // Наблюдатель заводится ПЕРВЫМ, то есть получает меньший employeeId. Это не
    // случайность: последний критерий тай-брейка в distributeFairly (shared/src/
    // distribute.ts) — возрастание employeeId, и при равной нагрузке смена уходит
    // младшему id. Заведи наблюдателя вторым — и смена досталась бы Ане просто по
    // тай-брейку, тест зеленел бы и без правила «наблюдатель вне раздачи». Порядок
    // здесь — то, что делает красный прогон (см. отчёт задачи) настоящим красным.
    const watcher = observer(db, "Игорь");
    createEmployee(db, { displayName: "Аня" });
    // Пустая смена, которую раздача обязана кому-то отдать.
    createShift(db, { date: day(1), start: "09:00", end: "18:00", category: "shift", employeeId: null });

    const { assignments } = buildDistribution(db, day(1), day(7));

    expect(assignments).not.toHaveLength(0);
    expect(assignments.map((a) => a.employeeId)).not.toContain(watcher.id);
  });

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
});
