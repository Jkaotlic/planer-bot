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
    /** Роль «Наблюдатель»: смотрит график, ведёт свой, шлёт анонсы — вне
     *  раздачи, обменов и передачи смен. Снятие роли не трогает исключения
     *  выше — они остаются такими же, как были до неё. */
    isObserver: z.boolean(),
    /** Тумблер «веду свой график сам», доступный только наблюдателю. Хранится
     *  и отдаётся всегда — снятая роль его не обнуляет, чтобы значение не
     *  терялось при повторном включении. */
    selfScheduleEnabled: z.boolean(),
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

/** Ответ правки и смены прав: тот же работник, что и в списке. */
export const adminEmployeeResponseSchema = z.object({ employee: adminEmployeeSchema }).strict();
export type AdminEmployeeResponse = z.infer<typeof adminEmployeeResponseSchema>;

/**
 * Ответ создания работника.
 *
 * Токен приглашения здесь намеренно и отдельным полем: админ только что завёл
 * человека, и ссылка нужна ему сразу. Внутри `employee` его быть не должно —
 * там он ехал вторым, незамеченным путём вместе с восемью прочими колонками
 * ряда, и `.strict()` на `adminEmployeeSchema` это теперь запрещает.
 *
 * `inviteLink` необязателен не по забывчивости: без `botUsername` в конфиге
 * сервер собрать её не из чего, и это нормальное состояние.
 */
export const createEmployeeResponseSchema = z
  .object({
    employee: adminEmployeeSchema,
    inviteToken: z.string(),
    inviteLink: z.string().nullable(),
  })
  .strict();
export type CreateEmployeeResponse = z.infer<typeof createEmployeeResponseSchema>;

/** Ответ выдачи приглашения: только ключ и ссылка, без работника рядом. */
export const employeeInviteResponseSchema = z
  .object({ inviteToken: z.string(), inviteLink: z.string().nullable() })
  .strict();
export type EmployeeInviteResponse = z.infer<typeof employeeInviteResponseSchema>;
