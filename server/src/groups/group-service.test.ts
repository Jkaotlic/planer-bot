import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { archiveEmployee, createEmployee, restoreEmployee } from "../repo/employees";
import { archiveGroup, createGroup, getGroup, listGroups, updateGroup } from "./group-service";

const today = "2026-09-30";

function stage() {
  const db = makeTestDb();
  const anya = createEmployee(db, { displayName: "Аня" }).id;
  const igor = createEmployee(db, { displayName: "Игорь" }).id;
  const mark = createEmployee(db, { displayName: "Марк" }).id;
  return { db, anya, igor, mark };
}

describe("группы", () => {
  it("создаются и читаются по имени; состав — по возрастанию id", () => {
    const { db, anya, igor, mark } = stage();
    createGroup(db, { name: "ЧИП 32 этаж", memberIds: [mark, igor] }, anya);
    createGroup(db, { name: "ЧИП 5-й этаж", memberIds: [anya] }, anya);
    expect(listGroups(db)).toEqual([
      { id: 1, name: "ЧИП 32 этаж", memberIds: [igor, mark] },
      { id: 2, name: "ЧИП 5-й этаж", memberIds: [anya] },
    ]);
  });

  it("имя уникально без учёта регистра среди живых групп; архивное имя можно занять", () => {
    const { db, anya } = stage();
    createGroup(db, { name: "ЧИП 5-й этаж", memberIds: [] }, anya);
    expect(createGroup(db, { name: "чип 5-Й ЭТАЖ", memberIds: [] }, anya)).toEqual({ ok: false, error: "Группа с таким названием уже есть." });
    archiveGroup(db, 1);
    expect(createGroup(db, { name: "ЧИП 5-й этаж", memberIds: [] }, anya).ok).toBe(true);
  });

  it("несуществующий сотрудник в составе — отказ без записи", () => {
    const { db, anya } = stage();
    expect(createGroup(db, { name: "X", memberIds: [anya, 999] }, anya)).toEqual({ ok: false, error: "В составе есть человек, которого нет в команде." });
    expect(listGroups(db)).toEqual([]);
  });

  it("уволенный выпадает из memberIds, восстановленный возвращается", () => {
    const { db, anya, igor } = stage();
    createGroup(db, { name: "X", memberIds: [anya, igor] }, anya);
    archiveEmployee(db, igor, today);
    expect(getGroup(db, 1)!.memberIds).toEqual([anya]);
    restoreEmployee(db, igor);
    expect(getGroup(db, 1)!.memberIds).toEqual([anya, igor]);
  });

  it("правка состава не теряет строку уволенного: после восстановления он снова в группе", () => {
    const { db, anya, mark } = stage();
    createGroup(db, { name: "X", memberIds: [anya, mark] }, anya);
    archiveEmployee(db, mark, today);
    expect(updateGroup(db, 1, { name: "X2" }).ok).toBe(true);
    expect(updateGroup(db, 1, { memberIds: [anya] }).ok).toBe(true);
    expect(getGroup(db, 1)!.memberIds).toEqual([anya]);
    restoreEmployee(db, mark);
    expect(getGroup(db, 1)!.memberIds).toEqual([anya, mark]);
  });

  it("правка заменяет состав целиком и переименовывает; конфликт имени — отказ", () => {
    const { db, anya, igor, mark } = stage();
    createGroup(db, { name: "A", memberIds: [anya, igor] }, anya);
    createGroup(db, { name: "B", memberIds: [] }, anya);
    expect(updateGroup(db, 1, { memberIds: [mark] }).ok).toBe(true);
    expect(getGroup(db, 1)!.memberIds).toEqual([mark]);
    expect(updateGroup(db, 1, { name: "b" })).toEqual({ ok: false, error: "Группа с таким названием уже есть." });
    expect(updateGroup(db, 1, { name: "A2" }).ok).toBe(true);
    expect(getGroup(db, 1)!.name).toBe("A2");
  });

  it("не больше 30 групп", () => {
    const { db, anya } = stage();
    for (let i = 0; i < 30; i += 1) createGroup(db, { name: `G${i}`, memberIds: [] }, anya);
    expect(createGroup(db, { name: "G30", memberIds: [] }, anya)).toEqual({ ok: false, error: "Групп уже 30 — удали лишнюю." });
  });

  it("архивная группа не видна, не правится и не архивируется второй раз", () => {
    const { db, anya } = stage();
    createGroup(db, { name: "X", memberIds: [] }, anya);
    expect(archiveGroup(db, 1)).toEqual({ ok: true });
    expect(getGroup(db, 1)).toBeNull();
    expect(updateGroup(db, 1, { name: "Y" })).toEqual({ ok: false, error: "Группы больше нет." });
    expect(archiveGroup(db, 1)).toEqual({ ok: false, error: "Группы больше нет." });
  });
});
