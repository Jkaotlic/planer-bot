import { describe, expect, it } from "vitest";
import { adminEmployeesResponseSchema } from "@planer/shared";
import { createEmployeesMock } from "./employees";

describe("мок домена employees", () => {
  const mock = createEmployeesMock({ delayMs: 0 });

  it("админский список проходит схему контракта", async () => {
    const parsed = adminEmployeesResponseSchema.safeParse({ employees: await mock.getAdminEmployees() });
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it("созданный работник проходит ту же схему", async () => {
    // Отдельный случай, потому что на сервере это была отдельная ручка со своей
    // формой ответа: она отдавала ряд таблицы и не отдавала `address`.
    const { employee } = await createEmployeesMock({ delayMs: 0 }).createEmployee("Марк");
    const parsed = adminEmployeesResponseSchema.safeParse({ employees: [employee] });
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it("с нулевой задержкой не спит", async () => {
    const started = Date.now();
    await mock.getAdminEmployees();
    expect(Date.now() - started).toBeLessThan(50);
  });
});
