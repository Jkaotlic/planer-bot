import { describe, expect, it } from "vitest";
import {
  adminEmployeeResponseSchema,
  adminEmployeesResponseSchema,
  createEmployeeResponseSchema,
  employeeBriefSchema,
  employeeInviteResponseSchema,
} from "./employees";

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
  isObserver: false,
  selfScheduleEnabled: false,
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

describe("формы ответов, которые домен отдаёт мимо списков", () => {
  it("создание отдаёт работника, токен и ссылку", () => {
    const parsed = createEmployeeResponseSchema.safeParse({
      employee: adminRow,
      inviteToken: "a1b2c3d4e5f6",
      inviteLink: "https://t.me/planer_bot?start=a1b2c3d4e5f6",
    });
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it("ссылки может не быть — имя бота серверу не обязано быть известно", () => {
    const parsed = createEmployeeResponseSchema.safeParse({
      employee: adminRow, inviteToken: "a1b2c3d4e5f6", inviteLink: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("создание не отдаёт работника с колонками ряда", () => {
    // Ровно это и уезжало: `c.json({ employee })` с целым рядом внутри.
    const parsed = createEmployeeResponseSchema.safeParse({
      employee: { ...adminRow, inviteToken: "inv-555", rosterOrder: 0 },
      inviteToken: "a1b2c3d4e5f6", inviteLink: null,
    });
    expect(parsed.success).toBe(false);
  });

  it("приглашение — это токен и ссылка, и больше ничего", () => {
    expect(employeeInviteResponseSchema.safeParse({ inviteToken: "t", inviteLink: null }).success).toBe(true);
    // Работник рядом с токеном означал бы, что ключ уехал вторым путём.
    expect(employeeInviteResponseSchema.safeParse({ inviteToken: "t", inviteLink: null, employee: adminRow }).success).toBe(false);
  });

  it("ответ с одним работником отвергает лишнее поле", () => {
    expect(adminEmployeeResponseSchema.safeParse({ employee: adminRow }).success).toBe(true);
    expect(adminEmployeeResponseSchema.safeParse({ employee: { ...adminRow, inviteToken: "x" } }).success).toBe(false);
  });
});
