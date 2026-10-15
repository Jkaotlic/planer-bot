import { afterEach, describe, expect, it } from "vitest";
import { MOCK_ME, mockCreateSelfEntry, mockDeleteSelfEntry, mockUpdateSelfEntry } from "./mock";
import { toISODate } from "../lib/week";

/**
 * DEV-мок самозаписи ведёт себя как сервер: админа правила работника не держат
 * (`admin: me.isAdmin` в `my-entries.ts`), работника — держат. Мок, строже
 * настоящей ручки, показал бы админу отказ, которого в проде нет.
 */

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

const wasAdmin = MOCK_ME.isAdmin;
afterEach(() => {
  MOCK_ME.isAdmin = wasAdmin;
});

describe("мок самозаписи и роль", () => {
  it("админ ставит себе больничный за месяц назад, правит и снимает кончившийся", async () => {
    MOCK_ME.isAdmin = true;
    const { entry } = await mockCreateSelfEntry({ category: "sick_leave", date: daysFromNow(-30), endDate: daysFromNow(-28) });
    const moved = await mockUpdateSelfEntry(entry.id, { category: "sick_leave", date: daysFromNow(-40), endDate: daysFromNow(-38) });
    expect(moved.date).toBe(daysFromNow(-40));
    await expect(mockDeleteSelfEntry(entry.id)).resolves.toBeUndefined();
  });

  it("работнику — тот же отказ, что на сервере", async () => {
    MOCK_ME.isAdmin = false;
    await expect(mockCreateSelfEntry({ category: "sick_leave", date: daysFromNow(-30) })).rejects.toThrow(/Больничный можно поставить не раньше/);
  });
});
