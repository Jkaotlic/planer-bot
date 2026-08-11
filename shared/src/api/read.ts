import { z } from "zod";
import { entryCategorySchema } from "../category";
import { dateStr, timeStr } from "../types";

/**
 * Пресет смены в том виде, в каком его читают оба фронта.
 *
 * Уже: сервер сегодня отдаёт весь ряд таблицы (`db.select()` без списка полей), то есть
 * ещё и `coverage`, `fillMode`, `rotationUnit`, `primaryEmployeeId`, `isActive`. Ни один
 * фронт их не читает — `rotationUnit` читается, но из `/api/admin/templates/:id/queue`,
 * а не отсюда. `.strict()` заставляет назвать это вслух, и ответ сужается до читаемого.
 */
export const templateSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    category: entryCategorySchema,
    start: timeStr,
    end: timeStr,
    fridayStart: timeStr.nullable(),
    fridayEnd: timeStr.nullable(),
    location: z.string().nullable(),
    /**
     * Цвет намеренно `z.string()`, а не перечисление: перечисление здесь означало бы,
     * что новый цвет в базе роняет контракт на каждом ответе. Цвет — это данные, а не
     * форма; его валидность проверяет тот, кто его рисует.
     */
    accent: z.string(),
    isLate: z.boolean(),
    sendReminder: z.boolean(),
    sortOrder: z.number().int(),
  })
  .strict();
export type TemplateDto = z.infer<typeof templateSchema>;

export const templatesResponseSchema = z.object({ templates: z.array(templateSchema) }).strict();
export type TemplatesResponse = z.infer<typeof templatesResponseSchema>;

/** Запись графика, безопасная для показа любому работнику: без `note`. */
export const scheduleEntrySchema = z
  .object({
    id: z.number().int(),
    date: dateStr,
    start: timeStr.nullable(),
    end: timeStr.nullable(),
    endDate: dateStr.nullable(),
    category: entryCategorySchema,
    title: z.string().nullable(),
    location: z.string().nullable(),
    unrecognisedCode: z.string().nullable(),
    templateId: z.number().int().nullable(),
    employeeId: z.number().int().nullable(),
  })
  .strict();
export type ScheduleEntryDto = z.infer<typeof scheduleEntrySchema>;

export const myShiftsResponseSchema = z
  .object({
    shifts: z.array(scheduleEntrySchema),
    today: dateStr,
  })
  .strict();
export type MyShiftsResponse = z.infer<typeof myShiftsResponseSchema>;

export const teamScheduleResponseSchema = z
  .object({
    employees: z.array(
      z
        .object({
          id: z.number().int(),
          displayName: z.string(),
          rosterOrder: z.number().int().nullable(),
          excludedFromSwaps: z.boolean(),
        })
        .strict(),
    ),
    shifts: z.array(scheduleEntrySchema),
  })
  .strict();
export type TeamScheduleResponse = z.infer<typeof teamScheduleResponseSchema>;
