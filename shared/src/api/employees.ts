import { z } from "zod";

/**
 * Коллега глазами работника: только имя. Ни телеграма, ни дат рождения.
 *
 * Назван `employeeBrief`, а не `employee`, потому что имя `employeeSchema` уже
 * занято в `shared/src/types.ts` — там оно описывает ряд таблицы, а не ответ
 * ручки. Два `export *` из одного `shared/src/index.ts` погасили бы оба имени
 * молча, и это заметил бы не компилятор, а тот, у кого перестал резолвиться
 * импорт.
 */
export const employeeBriefSchema = z
  .object({
    id: z.number().int(),
    displayName: z.string(),
  })
  .strict();
export type EmployeeBriefDto = z.infer<typeof employeeBriefSchema>;

/**
 * Работник глазами админа.
 *
 * `address` вычисляется, а не хранится: карточка показывает, как бот к человеку
 * обратится на самом деле, — так видно, кому обращение ещё не задано.
 *
 * Ряд таблицы шире этого списка на девять колонок, и все девять сюда уезжали:
 * `tgUsername`, `tgFirstName`, `phone`, `remindersEnabled`, `prepBufferMin`,
 * `inviteToken`, `archivedAt`, `rosterOrder`, `createdAt`. Ни одну из них не
 * объявляет тип `Employee` ни одного из двух фронтов, то есть не читает ни один
 * экран. `inviteToken` среди них — не просто лишнее поле, а ключ привязки
 * чужого телеграма к работнику.
 */
export const adminEmployeeSchema = z
  .object({
    id: z.number().int(),
    displayName: z.string(),
    preferredName: z.string().nullable(),
    address: z.string(),
    isAdmin: z.boolean(),
    isActive: z.boolean(),
    telegramUserId: z.number().int().nullable(),
    birthDate: z.string().nullable(),
    excludedFromAssignment: z.boolean(),
    excludedFromSwaps: z.boolean(),
  })
  .strict();
export type AdminEmployeeDto = z.infer<typeof adminEmployeeSchema>;

export const employeesResponseSchema = z
  .object({ employees: z.array(employeeBriefSchema) })
  .strict();
export type EmployeesResponse = z.infer<typeof employeesResponseSchema>;

export const adminEmployeesResponseSchema = z
  .object({ employees: z.array(adminEmployeeSchema) })
  .strict();
export type AdminEmployeesResponse = z.infer<typeof adminEmployeesResponseSchema>;
