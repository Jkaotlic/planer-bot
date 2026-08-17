import { describe, expect, it } from "vitest";
import { openDb, runMigrations } from "./client";

/**
 * Горячие чтения идут по индексу, а не полным сканом.
 *
 * До этой миграции на `shifts`, `swap_requests`, `vacant_slots` и `audit_log` не
 * было ни одного индекса, и семь горячих запросов шли `SCAN` — в том числе 28
 * сканов за одно «Распределить честно». Замер на размноженной копии живой базы:
 * 1038 строк → 1.3 мс, 6188 (≈ +1 год) → 6.4 мс, 20608 (≈ +3 года) → 21.4 мс.
 * Не горело, но его добро получено 2026-08-17, а миграция делается один раз.
 *
 * Проверяется план, а не время: время на пустой тестовой базе ничего не скажет
 * (SQLite и скан по десяти строкам сделает мгновенно), а план — это ровно то
 * утверждение, которое индекс и обещает. Тест падает, если миграцию потеряли или
 * если запрос переписали так, что индекс перестал подходить.
 */
function planFor(sql: string): string {
  const { db, sqlite } = openDb(":memory:");
  runMigrations(db, sqlite);
  const rows = sqlite.prepare(`explain query plan ${sql}`).all() as { detail: string }[];
  const plan = rows.map((row) => row.detail).join(" | ");
  sqlite.close();
  return plan;
}

describe("индексы под горячие чтения", () => {
  const cases: { what: string; sql: string; index: string }[] = [
    {
      what: "расписание за месяц (обе сетки, отчёты, выгрузка)",
      sql: "select * from shifts where date >= '2026-08-01' and date <= '2026-08-31'",
      index: "shift_date",
    },
    {
      what: "история одного человека (баланс, честное распределение)",
      sql: "select * from shifts where employee_id = 3 and date >= '2026-08-01'",
      index: "shift_employee_date",
    },
    {
      what: "«мои обмены» на экране работника",
      sql: "select * from swap_requests where from_employee_id = 3 or to_employee_id = 3",
      index: "swap_",
    },
    {
      what: "висящие заявки на смену — теперь спрашиваются при каждом переносе даты",
      sql: "select * from swap_requests where status = 'pending' and (from_shift_id = 5 or to_shift_id = 5)",
      index: "swap_",
    },
    {
      what: "журнал «кто что менял», по страницам",
      sql: "select * from audit_log order by created_at desc, id desc limit 50",
      index: "audit_created",
    },
    {
      what: "открытые слоты выходного дня",
      sql: "select * from vacant_slots where date >= '2026-08-01'",
      index: "vacant_slot_date",
    },
  ];

  for (const { what, sql, index } of cases) {
    it(what, () => {
      const plan = planFor(sql);
      expect(plan).toContain("USING INDEX");
      expect(plan).toContain(index);
      // Ни одного шага, читающего таблицу МИМО индекса. Формулировка именно такая,
      // потому что `SCAN audit_log USING INDEX audit_created` — это не полный скан,
      // а обход индекса в нужном порядке: журналу нужны верхние пятьдесят строк, и
      // на пятидесятой обход кончается. Плохо выглядит только «SCAN» без индекса.
      const bareScans = plan.split(" | ").filter((step) => step.startsWith("SCAN ") && !step.includes("USING INDEX"));
      expect(bareScans).toEqual([]);
    });
  }

  it("журнал больше не сортируется во временном b-tree", () => {
    // Именно это и стоило дорого: не поиск строк, а сортировка всей таблицы
    // ради пятидесяти верхних.
    expect(planFor("select * from audit_log order by created_at desc, id desc limit 50")).not.toContain("TEMP B-TREE");
  });
});
