import type { FoodDishShape, FoodMenuItemShape } from "../food-order";
import type { PaymentRow } from "../collection-payment";
import type { PollChoice, PollTally } from "../poll";

/**
 * Ответы ручек заказов, опросов и мест — глазами того, кто открыл экран.
 *
 * Здесь, а не в клиенте мини-аппа: с 2026-10-06 те же ответы читает и консоль, и
 * две копии одной формы разъезжаются молча — ровно так `Category` и
 * `EntryCategory` однажды стали двумя именами одного типа. Сервер держит свои
 * объявления (`poll-service.ts`, `order-service.ts`, `place-service.ts`) — этот
 * заход сервер не трогает; поля совпадают поле в поле.
 *
 * `canManage`, `people` и `payment.rows` уже посчитаны сервером (запускающий или
 * админ; «кто сколько» — только им). Экран правило не повторяет.
 */
export interface PollView {
  id: number;
  question: string;
  creatorId: number;
  creatorName: string;
  closesAt: string | null;
  closes: string | null;
  open: boolean;
  cancelled: boolean;
  isCreator: boolean;
  canManage: boolean;
  myChoice: PollChoice | null;
  tally: PollTally;
  recipientCount: number;
}

/** Место с меню — общее для всей команды, как и опрос. */
export interface PlaceView {
  id: number;
  name: string;
  menu: FoodMenuItemShape[];
}

export interface OrderView {
  id: number;
  creatorId: number;
  creatorName: string;
  placeId: number | null;
  /** Название сбора («Икра, доставка 09.10»); `null` — обычный заказ по месту. */
  title: string | null;
  placeName: string | null;
  /** Можно ли добавлять позиции вне меню. */
  allowCustom: boolean;
  menu: FoodMenuItemShape[];
  note: string | null;
  payHint: string | null;
  closesAt: string | null;
  closes: string | null;
  open: boolean;
  closed: boolean;
  cancelled: boolean;
  isCreator: boolean;
  canManage: boolean;
  myItems: (FoodDishShape & { id: number })[];
  myTotal: number;
  declined: boolean;
  recipientCount: number;
  respondedCount: number;
  dishes: FoodDishShape[];
  total: number;
  people:
    | {
        employeeId: number;
        displayName: string;
        amount: number;
        declined: boolean;
        items: FoodDishShape[];
      }[]
    | null;
  /** Кто уже сдал. `rows` — только запускающему/админу, как и `people`. */
  payment: { myPaid: boolean; paidCount: number; total: number; rows: (PaymentRow & { amount: number })[] | null };
}

/** Итог рассылки опроса или заказа: сколько дошло и кому — нет. */
export interface FoodSendReport {
  delivered: number;
  unreachable: string[];
}

/** Итог «Напомнить не сдавшим»: `unpaid` — знаменатель «D из N». */
export interface OrderRemindResult {
  delivered: number;
  unpaid: number;
  unreachable: string[];
}
