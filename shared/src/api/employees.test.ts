import { describe, expect, it } from "vitest";
import { adminEmployeesResponseSchema, employeeBriefSchema } from "./employees";

const adminRow = {
  id: 1,
  displayName: "Аня",
  preferredName: null,
  address: "Аня",
  isAdmin: false,
  isActive: true,
  telegramUserId: 555,
  birthDate: "03-14",
  excludedFromAssignment: false,
  excludedFromSwaps: false,
};

describe("схемы домена employees", () => {
  it("работник видит коллегу только по имени", () => {
    expect(employeeBriefSchema.safeParse({ id: 1, displayName: "Аня" }).success).toBe(true);
  });

  it("работнику не отдаётся телеграм коллеги", () => {
    // .strict() здесь несёт не косметику: это граница того, что видно рядовому
    // работнику. Лишнее поле в этом ответе — утечка, а не неопрятность.
    const parsed = employeeBriefSchema.safeParse({ id: 1, displayName: "Аня", telegramUserId: 555 });
    expect(parsed.success).toBe(false);
  });

  it("админский список принимает сегодняшнюю форму", () => {
    const parsed = adminEmployeesResponseSchema.safeParse({ employees: [adminRow] });
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it("админский список отвергает токен приглашения", () => {
    // Не произвольное «лишнее поле»: `inviteToken` — это ключ, которым чужой
    // телеграм привязывается к работнику. В списке он не нужен ничему.
    const parsed = adminEmployeesResponseSchema.safeParse({
      employees: [{ ...adminRow, inviteToken: "inv-555" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("отвергает работника без обязательного displayName", () => {
    const { displayName, ...withoutName } = adminRow;
    expect(adminEmployeesResponseSchema.safeParse({ employees: [withoutName] }).success).toBe(false);
  });
});
