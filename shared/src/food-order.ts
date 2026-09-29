import { z } from "zod";

/**
 * Лимиты заказа еды. Один процесс держит и API, и long-polling бота, поэтому
 * всё, что уходит в рассылку или в кнопки чата, ограничено сверху.
 *
 * 30 блюд — не вкус, а Telegram: больше кнопок в письме не читаются, а
 * `callback_data` каждой — ещё строка в каждом письме каждому адресату.
 */
export const FOOD_TEXT_MAX = 200;
export const FOOD_NOTE_MAX = 300;
export const FOOD_MENU_MAX = 30;
export const FOOD_PRICE_MAX = 100_000;
export const FOOD_QTY_MAX = 20;

/** Цена — целые рубли: копейки в обеде никто не сдаёт, а дробь в долге — повод для спора. */
export const foodPriceSchema = z.number().int().min(1).max(FOOD_PRICE_MAX);
const foodText = z.string().trim().min(1).max(FOOD_TEXT_MAX);

export const placeInputSchema = z
  .object({
    name: foodText,
    menu: z
      .array(z.object({ id: z.number().int().positive().optional(), name: foodText, price: foodPriceSchema }).strict())
      .max(FOOD_MENU_MAX),
  })
  .strict()
  .refine(
    (p) => new Set(p.menu.map((m) => m.name.toLocaleLowerCase("ru"))).size === p.menu.length,
    { message: "В меню два блюда с одним названием — в чате их кнопки не различить.", path: ["menu"] },
  )
  // Повторный id в одном теле запроса — само по себе противоречивое тело:
  // сервис (`updatePlace`) обновляет блюдо по id первым найденным, и вторая
  // строка с тем же id молча потерялась бы, а не стала отдельным блюдом.
  .refine(
    (p) => {
      const ids = p.menu.map((m) => m.id).filter((id): id is number => id != null);
      return new Set(ids).size === ids.length;
    },
    { message: "В меню дважды указан один и тот же id блюда.", path: ["menu"] },
  );

export type PlaceInput = z.infer<typeof placeInputSchema>;
