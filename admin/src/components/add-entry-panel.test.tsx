import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AddEntryPanel } from "./AddEntryPanel";
import type { Employee, Shift } from "../api/client";

const WEEK = ["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"];

const employee: Employee = {
  id: 1, displayName: "Иванов Иван", isAdmin: false, isActive: true,
  telegramUserId: null, birthDate: null, address: "Иван",
};

/** Отпуск, заведённый импортом: начинается в показанной неделе, кончается через две. */
const longVacation: Shift = {
  id: 10, date: "2026-06-08", start: null, end: null, endDate: "2026-06-22",
  category: "vacation", title: null, templateId: null, employeeId: 1,
};

const render = (existing: Shift) =>
  renderToStaticMarkup(
    <AddEntryPanel
      employees={[employee]}
      templates={[]}
      weekDates={WEEK}
      initialEmployeeId={1}
      initialDate="2026-06-08"
      existing={existing}
      onCancel={() => {}}
      onSave={async () => {}}
    />,
  );

describe("AddEntryPanel «по какой день»", () => {
  /**
   * Отпуска приходят из импорта целыми прогонами — в живом файле `otp` тянется по
   * две недели, а панель предлагала только дни показанной недели. У записи,
   * кончающейся позже воскресенья, выбранного варианта в списке нет: браузер
   * показывает первый, то есть экран сообщает админу, что отпуск кончается в
   * понедельник. Тронув селект «чтобы проверить», он молча обрежет отпуск до
   * конца недели — выразить настоящую дату этим экраном нельзя.
   */
  it("offers the entry's own end date even when it falls outside the shown week", () => {
    const html = render(longVacation);
    expect(html).toContain('value="2026-06-22"');
    expect(html).toMatch(/<option[^>]*value="2026-06-22"[^>]*selected/);
  });

  it("still offers the shown week's days for a single-day absence", () => {
    const html = render({ ...longVacation, endDate: null });
    for (const iso of WEEK) expect(html).toContain(`value="${iso}"`);
  });
});
