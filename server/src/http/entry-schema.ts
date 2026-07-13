import { z } from "zod";
import { entryCategorySchema, timeStr, dateStr } from "@planer/shared";

export const createEntrySchema = z.object({
  date: dateStr,
  category: entryCategorySchema.default("shift"),
  start: timeStr.nullish(),
  end: timeStr.nullish(),
  endDate: dateStr.nullish(),
  templateId: z.number().int().nullish(),
  employeeId: z.number().int().nullish(),
  location: z.string().nullish(),
  title: z.string().nullish(),
  note: z.string().nullish(),
});

export const updateEntrySchema = createEntrySchema.partial();

export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
