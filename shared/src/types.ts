import { z } from "zod";

/** "HH:MM" 24h wall-clock. */
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");
/** "YYYY-MM-DD". */
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const employeeSchema = z.object({
  id: z.number().int(),
  telegramUserId: z.number().int().nullable(),
  tgUsername: z.string().nullable(),
  displayName: z.string().min(1),
  phone: z.string().nullable(),
  isAdmin: z.boolean(),
  isActive: z.boolean(),
  remindersEnabled: z.boolean(),
  prepBufferMin: z.number().int().nonnegative(),
});
export type Employee = z.infer<typeof employeeSchema>;

export const shiftTemplateSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  start: timeStr,
  end: timeStr,
  fridayStart: timeStr.nullable(),
  fridayEnd: timeStr.nullable(),
  isLate: z.boolean(),
  sendReminder: z.boolean(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export type ShiftTemplate = z.infer<typeof shiftTemplateSchema>;

export const shiftSchema = z.object({
  id: z.number().int(),
  date: dateStr,
  start: timeStr,
  end: timeStr,
  templateId: z.number().int().nullable(),
  title: z.string().nullable(),
  employeeId: z.number().int().nullable(),
  note: z.string().nullable(),
});
export type Shift = z.infer<typeof shiftSchema>;

export const swapStatusSchema = z.enum([
  "pending", "accepted", "declined", "cancelled", "expired",
]);
export type SwapStatus = z.infer<typeof swapStatusSchema>;

export type SwapEvent = "accept" | "decline" | "cancel" | "expire";
