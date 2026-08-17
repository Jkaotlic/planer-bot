import { describe, expect, it } from "vitest";
import { pluralRecords, rosterImportSummaryLine } from "./roster-summary";

/**
 * Одна сводка на обе консоли.
 *
 * Была копия в `admin/src/App.tsx` с комментарием «Mirror of `summaryLine` in
 * miniapp/…» — и комментарий врал: десктопная половина не несла хвост «⚠ Не понял
 * N клеток». То есть после импорта файла, наставившего в сетке знаки «?», консоль
 * говорила только «CSV загружен» — а мини-апп про те же клетки предупреждал.
 * Найдено в проходе линзы `csv`, лежало в «Идеях».
 */
describe("сводка импорта ростера", () => {
  // Полный набор случаев перенесён из `admin/src/App.test.ts` — там он проверял
  // копию, которой больше нет.
  it("считает записи по-русски", () => {
    expect([0, 1, 2, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(pluralRecords)).toEqual([
      "0 записей", "1 запись", "2 записи", "5 записей",
      "11 записей", "12 записей", "14 записей",
      "21 запись", "22 записи", "25 записей",
      "101 запись", "111 записей",
    ]);
  });

  it("называет только то, что произошло", () => {
    expect(rosterImportSummaryLine({ entriesInserted: 3, entriesDeleted: 0, cellsPreserved: 0, employeesCreated: 0 })).toBe(
      "CSV загружен: добавлено 3 записи",
    );
  });

  it("перечисляет замену, нетронутое и новых людей", () => {
    expect(
      rosterImportSummaryLine({ entriesInserted: 10, entriesDeleted: 4, cellsPreserved: 2, employeesCreated: 1 }),
    ).toBe("CSV загружен: добавлено 10 записей, заменено 4 записи, не тронуто 2 записи, новых сотрудников — 1");
  });

  it("предупреждает про нераспознанные клетки — то, чего не было в консоли", () => {
    const line = rosterImportSummaryLine({
      entriesInserted: 5, entriesDeleted: 0, cellsPreserved: 0, employeesCreated: 0,
      unknowns: [{ name: "Аня", date: "2026-08-03", code: "Ко" }],
    });

    expect(line).toContain("Не понял 1 клетку");
    expect(line).toContain("«?»");
  });

  it("предупреждает про погашенные обмены", () => {
    const line = rosterImportSummaryLine({
      entriesInserted: 5, entriesDeleted: 5, cellsPreserved: 0, employeesCreated: 0, swapsExpired: 2,
    });

    expect(line).toContain("2 заявок на обмен стали неактуальны");
    expect(line).toContain("обеим сторонам написали");
  });

  it("говорит и про то, и про другое, если случилось и то, и другое", () => {
    const line = rosterImportSummaryLine({
      entriesInserted: 5, entriesDeleted: 5, cellsPreserved: 0, employeesCreated: 0, swapsExpired: 1,
      unknowns: [{ name: "Аня", date: "2026-08-03", code: "Ко" }, { name: "Игорь", date: "2026-08-04", code: "Хз" }],
    });

    expect(line).toContain("Не понял 2 клеток");
    expect(line).toContain("1 заявка на обмен стала неактуальной");
  });
});
