import { z } from "zod";

/**
 * Группа адресатов: список людей, который админ правит сам и выбирает одной
 * кнопкой в рассылках («ЧИП 5-й этаж»). Правила здесь, потому что их читают
 * сервер и обе консоли — формы должны отказывать тем же текстом и тем же
 * лимитом, что и ручка.
 */
export const RECIPIENT_GROUP_NAME_MAX = 40;
/** Больше тридцати кнопок в ряду выбора адресатов не читаются на телефоне. */
export const RECIPIENT_GROUPS_MAX = 30;
/** Тот же потолок, что у анонсов и заказов: больше людей в команде не бывает. */
export const RECIPIENT_GROUP_MEMBERS_MAX = 200;

const name = z.string().trim().min(1).max(RECIPIENT_GROUP_NAME_MAX);
// Повторный id в списке — не ошибка человека, а двойной тап по галочке;
// молча схлопываем, порядок первого появления сохраняем.
const memberIds = z
  .array(z.number().int().positive())
  .max(RECIPIENT_GROUP_MEMBERS_MAX)
  .transform((ids) => [...new Set(ids)]);

export const recipientGroupInputSchema = z.object({ name, memberIds }).strict();
export const recipientGroupPatchSchema = z
  .object({ name: name.optional(), memberIds: memberIds.optional() })
  .strict()
  .refine((p) => p.name !== undefined || p.memberIds !== undefined, { message: "Нечего сохранять." });

export type RecipientGroupInput = z.infer<typeof recipientGroupInputSchema>;
export type RecipientGroupPatch = z.infer<typeof recipientGroupPatchSchema>;

export interface RecipientGroupView {
  id: number;
  name: string;
  /** Только активные сотрудники: уволенный из рассылок выпадает сам. */
  memberIds: number[];
}
