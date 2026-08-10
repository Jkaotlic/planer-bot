import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { setTemplateRoles } from "../repo/template-roles";
import { shiftTemplates } from "../db/schema";
import { outsidePoolFact, outsidePoolFacts } from "./duty-notice";

/**
 * Пул дежурства ничего не запрещает — его решение от 2026-08-10. Но раз он не
 * запрещает, он обязан хотя бы сказать: иначе на Поклонке молча окажется тот,
 * кто там никогда не был.
 *
 * Функция отдаёт ФАКТ, а не фразу: одна и та же правда звучит по-разному тому,
 * кто берёт дежурство («ты не в списке»), и админам, которые читают про третьего
 * человека («Игорь не в списке»). Слова живут в `notify.ts`, рядом со всеми
 * остальными текстами бота.
 */
function setup() {
  const db = makeTestDb();
  const anya = createEmployee(db, { displayName: "Аня" });
  const igor = createEmployee(db, { displayName: "Игорь" });
  const pokl = db
    .insert(shiftTemplates)
    .values({ name: "Дежурство · Поклонка", category: "duty", start: "09:00", end: "18:00" })
    .returning()
    .all()[0]!;
  const duty = createShift(db, {
    date: "2026-07-10", start: "09:00", end: "18:00", category: "duty",
    templateId: pokl.id, title: pokl.name, employeeId: anya.id,
  });
  const shift = createShift(db, { date: "2026-07-10", start: "11:00", end: "20:00", employeeId: igor.id });
  return { db, anya, igor, pokl, duty, shift };
}

describe("outsidePoolFact", () => {
  it("дежурство уходит человеку вне пула — есть что сказать", () => {
    const { db, anya, igor, pokl, duty } = setup();
    setTemplateRoles(db, pokl.id, { pool: [anya.id], preference: {} });
    expect(outsidePoolFact(db, { shiftId: duty.id, receiverId: igor.id })).toEqual({
      dutyName: "Дежурство · Поклонка",
      receiverName: "Игорь",
    });
  });

  it("берущий в пуле — говорить нечего", () => {
    const { db, anya, igor, pokl, duty } = setup();
    setTemplateRoles(db, pokl.id, { pool: [anya.id, igor.id], preference: {} });
    expect(outsidePoolFact(db, { shiftId: duty.id, receiverId: igor.id })).toBeNull();
  });

  // Пустой пул = можно всем: это правило `template_pool`, а не «пул забыли настроить».
  it("пустой пул — говорить нечего", () => {
    const { db, igor, duty } = setup();
    expect(outsidePoolFact(db, { shiftId: duty.id, receiverId: igor.id })).toBeNull();
  });

  it("обычная смена — не про пул", () => {
    const { db, anya, shift } = setup();
    expect(outsidePoolFact(db, { shiftId: shift.id, receiverId: anya.id })).toBeNull();
  });

  it("пропавшая запись — говорить нечего", () => {
    const { db, igor } = setup();
    expect(outsidePoolFact(db, { shiftId: null, receiverId: igor.id })).toBeNull();
    expect(outsidePoolFact(db, { shiftId: 9999, receiverId: igor.id })).toBeNull();
  });

  // Дежурство ↔ дежурство: вне пула могут оказаться ОБА, потому и список.
  it("обе стороны сразу", () => {
    const { db, anya, igor, duty } = setup();
    const v19 = db
      .insert(shiftTemplates)
      .values({ name: "Дежурство · Вавилова 19", category: "duty", start: "10:00", end: "19:00" })
      .returning()
      .all()[0]!;
    const his = createShift(db, {
      date: duty.date, start: "10:00", end: "19:00", category: "duty",
      templateId: v19.id, title: v19.name, employeeId: igor.id,
    });
    const outsider = createEmployee(db, { displayName: "Марк" });
    setTemplateRoles(db, duty.templateId!, { pool: [outsider.id], preference: {} });
    setTemplateRoles(db, v19.id, { pool: [outsider.id], preference: {} });

    expect(
      outsidePoolFacts(db, {
        fromEmployeeId: anya.id, toEmployeeId: igor.id, fromShiftId: duty.id, toShiftId: his.id,
      }),
    ).toEqual([
      { dutyName: "Дежурство · Поклонка", receiverName: "Игорь" },
      { dutyName: "Дежурство · Вавилова 19", receiverName: "Аня" },
    ]);
  });
});
