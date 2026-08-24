import { describe, it, expect } from "vitest";
import { allowedByPool, rolesOfPerson, toggleAllowed, togglePreference } from "./kind-roles";

const ANYA = 1, IGOR = 2, MARK = 3;
const ACTIVE = [ANYA, IGOR, MARK];
const morning = { templateId: 10, name: "Утро", pool: [] as number[], preference: {} as Record<number, number> };

describe("allowedByPool", () => {
  it("читает пустой пул как «допущены все»", () => {
    expect(allowedByPool([], IGOR)).toBe(true);
    expect(allowedByPool(null, IGOR)).toBe(true);
    expect(allowedByPool(undefined, IGOR)).toBe(true);
  });

  it("непустой пул допускает только своих", () => {
    expect(allowedByPool([ANYA], ANYA)).toBe(true);
    expect(allowedByPool([ANYA], IGOR)).toBe(false);
  });
});

describe("rolesOfPerson", () => {
  it("читает пустой пул как «допущены все»", () => {
    const [role] = rolesOfPerson([morning], IGOR);
    expect(role).toMatchObject({ templateId: 10, name: "Утро", allowed: true, poolIsEmpty: true, preferred: false });
  });

  it("вне непустого пула человек не допущен", () => {
    const [role] = rolesOfPerson([{ ...morning, pool: [ANYA] }], IGOR);
    expect(role).toMatchObject({ allowed: false, poolIsEmpty: false });
  });

  it("«любит» читается из преференций", () => {
    const [role] = rolesOfPerson([{ ...morning, preference: { [IGOR]: 1 } }], IGOR);
    expect(role!.preferred).toBe(true);
  });

  it("сохраняет порядок видов смен", () => {
    const roles = rolesOfPerson([morning, { ...morning, templateId: 20, name: "Дежурство" }], IGOR);
    expect(roles.map((r) => r.templateId)).toEqual([10, 20]);
  });
});

describe("toggleAllowed", () => {
  it("снятие при пустом пуле материализует его без этого человека", () => {
    expect(toggleAllowed([], IGOR, ACTIVE)).toEqual([ANYA, MARK]);
  });

  it("возврат последнего недостающего схлопывает пул обратно в «все»", () => {
    expect(toggleAllowed([ANYA, MARK], IGOR, ACTIVE)).toEqual([]);
  });

  it("снимает одного из непустого пула", () => {
    expect(toggleAllowed([ANYA, IGOR], IGOR, ACTIVE)).toEqual([ANYA]);
  });

  it("добавляет в пул, пока допущены не все", () => {
    expect(toggleAllowed([ANYA], IGOR, ACTIVE)).toEqual([ANYA, IGOR]);
  });

  it("отказывается снять последнего допущенного", () => {
    // Пустой пул значит «допущены все» — снятие последней галочки дало бы ровно
    // противоположное тому, чего добивался админ.
    expect(toggleAllowed([IGOR], IGOR, ACTIVE)).toBeNull();
  });

  it("уволенный в пуле не мешает схлопыванию", () => {
    // В пуле остался id человека, которого больше нет в активных: без этого
    // правила пул никогда бы не схлопнулся и новый сотрудник не попал бы никуда.
    expect(toggleAllowed([ANYA, MARK, 99], IGOR, ACTIVE)).toEqual([]);
  });
});

describe("togglePreference", () => {
  it("ставит и снимает «любит», не трогая остальных", () => {
    expect(togglePreference({ [ANYA]: 1 }, IGOR)).toEqual({ [ANYA]: 1, [IGOR]: 1 });
    expect(togglePreference({ [ANYA]: 1, [IGOR]: 1 }, IGOR)).toEqual({ [ANYA]: 1 });
  });

  it("сохраняет вес, который поставил не экран", () => {
    // Вес приходит из базы и бывает больше единицы; галочка чужой вес не трогает.
    expect(togglePreference({ [ANYA]: 3 }, IGOR)).toEqual({ [ANYA]: 3, [IGOR]: 1 });
  });
});
