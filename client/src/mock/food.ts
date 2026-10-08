import {
  FOOD_CLOSE_HORIZON_DAYS, dateStr, FOOD_ITEMS_PER_PERSON_MAX, FOOD_QTY_MAX, announcementRole, closesAtFromTime, closesLabel, debtOf, debtors, dishSummary,
  isFutureClose, isOpenAt, isWithinCloseHorizon, orderItemInputSchema, orderTotal, paymentProgress, placeInputSchema, pollTally,
  type AudienceCandidate, type FoodSendReport, type FoodUnit, type OrderRemindResult, type OrderView, type PlaceInput, type PlaceView,
  type PollChoice, type PollView, type TeamAudience,
} from "@planer/shared";
import { delay } from "./delay";

/** Кого мок знает о человеке — ровно то, что нужно правилам рассылки и прав. */
export interface FoodMockPerson {
  id: number;
  displayName: string;
  isActive: boolean;
  isAdmin: boolean;
  isObserver: boolean;
  telegramUserId: number | null;
}

/**
 * Состояние — у морды, правила — здесь. Тот же раздел, что у `createEmployeesMock`:
 * людей правят ещё не переехавшие домены («Работники», импорт ростера), и правка
 * должна сразу быть видна и здесь, поэтому массив и «кто я» читаются геттерами
 * при каждом вызове, а не копируются при создании.
 */
export interface FoodMockState {
  readonly employees: readonly FoodMockPerson[];
  readonly me: { id: number; isAdmin: boolean };
}

export interface FoodMockOptions {
  delayMs: number;
  state: FoodMockState;
  /** «Сейчас» команды. Мок живёт без `teamNow` и базы, поэтому по умолчанию — местные дата и время браузера. */
  now?: () => { date: string; time: string };
}

/**
 * Прежний `mockNow()` брал дату по UTC, а время — местное: с полуночи до трёх
 * ночи по Москве срок «сегодня в 23:45» оказывался вчерашним.
 */
function localNow(): { date: string; time: string } {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/**
 * Dev-мок опросов, мест и заказов еды — один на мини-апп и консоль.
 *
 * Правила и тексты отказов — те же, что у сервера (`order-service.ts`,
 * `poll-service.ts`, ручки в `server/src/http/routes/`), и считаются теми же
 * функциями из `@planer/shared`: DEV не должен пропускать то, что отклонит прод.
 */
export function createFoodMock(opts: FoodMockOptions) {
  const { delayMs, state } = opts;
  // Имена `clock`/`staff`, а не `now`/`people`: внутри перенесённого кода это
  // же слова — локальные переменные, и они затеняли бы помощников.
  const clock = opts.now ?? localNow;
  const wait = () => delay(delayMs);
  const staff = () => state.employees;
  const me = () => state.me;
  const nameOf = (id: number) => staff().find((e) => e.id === id)?.displayName ?? "Без имени";

  // --- Опросы («Заказы и опросы») ----------------------------------------------
  // Правила голосования, срока и итога — из `@planer/shared`, теми же функциями,
  // что и сервер (`closesAtFromTime`, `isOpenAt`, `pollTally`), а не переизобретены
  // здесь: иначе DEV-режим однажды показал бы опрос закрытым не в ту секунду, что прод.

  interface MockPoll {
    id: number;
    question: string;
    createdBy: number;
    closesAt: string | null;
    closedAt: string | null;
    cancelledAt: string | null;
    recipients: number[];
    votes: Map<number, PollChoice>;
  }

  const POLLS: MockPoll[] = [];
  let nextPollId = 1;

  /**
   * Детерминированная по id «занятость на сегодня» — DEV-мок живёт без графика,
   * выдумывать его нечем. Одна функция на обе ручки (`getTeamAudience` и
   * `createPoll`): раньше «на смене» в списке кандидатов считалось по
   * индексу отфильтрованного массива (`i % 2`), а в заказе опроса — вообще
   * никак («на смене» слало всем активным) — форма и подсказка под ней
   * молчаливо расходились в том, кому реально уйдёт опрос.
   */
  function onShift(employeeId: number): boolean {
    return employeeId % 2 === 1;
  }

  function pollViewOf(p: MockPoll): PollView {
    const now = clock();
    const people = p.recipients.map((id) => ({ employeeId: id, displayName: staff().find((e) => e.id === id)?.displayName ?? "—" }));
    return {
      id: p.id,
      question: p.question,
      creatorId: p.createdBy,
      creatorName: staff().find((e) => e.id === p.createdBy)?.displayName ?? "—",
      closesAt: p.closesAt,
      closes: closesLabel(p.closesAt, now.date),
      open: isOpenAt(p, now),
      cancelled: p.cancelledAt != null,
      isCreator: p.createdBy === me().id,
      canManage: p.createdBy === me().id || me().isAdmin,
      myChoice: p.votes.get(me().id) ?? null,
      tally: pollTally(people, [...p.votes].map(([employeeId, choice]) => ({ employeeId, choice }))),
      recipientCount: p.recipients.length,
    };
  }

  /** Кандидаты в адресаты опроса/заказа — сам вызывающий исключён, как на сервере
   *  (`audienceCandidates`): себя выбирать незачем, он в рассылке всегда. */
  async function getTeamAudience(): Promise<AudienceCandidate[]> {
    await wait();
    return staff().filter((e) => e.isActive && e.id !== me().id).map((e) => ({
      id: e.id,
      displayName: e.displayName,
      reachable: e.telegramUserId != null,
      role: announcementRole(e),
      onShift: onShift(e.id),
    }));
  }

  async function getPolls(): Promise<PollView[]> {
    await wait();
    return [...POLLS].reverse().map(pollViewOf);
  }

  /**
   * Кого мок реально позовёт — те же правила, что серверный `resolveAudience`:
   * «команда» берёт всех активных, «на смене»
   * фильтрует по `onShift`. Раньше «на смене» в DEV слало вообще всем активным —
   * форма спрашивала одно, а получал бы другое.
   */
  function audienceIds(audience: TeamAudience): number[] {
    const active = staff().filter((e) => e.isActive);
    const chosen = audience.kind === "picked"
      ? audience.employeeIds
      : audience.kind === "team"
        ? active.map((e) => e.id)
        : active.filter((e) => onShift(e.id)).map((e) => e.id);
    // Наблюдателям — копия всегда (как `resolveAudience` с 2026-10-06); без Telegram — нет:
    // его не звали, и в «не дойдёт» он попасть не должен.
    const observers = active.filter((e) => e.isObserver && e.telegramUserId != null && !chosen.includes(e.id)).map((e) => e.id);
    return [...chosen, ...observers];
  }

  async function createPoll(input: { question: string; closesTime: string | null; audience: TeamAudience }): Promise<{ poll: PollView } & FoodSendReport> {
    await wait();
    if (!input.question.trim()) throw new Error("Проверь вопрос, время и адресатов.");
    const now = clock();
    const closesAt = closesAtFromTime(input.closesTime, now.date);
    // Тот же отказ и тот же текст, что у ручки `POST /api/polls` на сервере —
    // иначе DEV показал бы опрос, у которого приём голосов кончился в момент
    // рождения, и кнопки на карточке были бы погашены с первого рендера.
    if (!isFutureClose(closesAt, now)) throw new Error("Время уже прошло — поставь позже или оставь пустым.");

    const ids = audienceIds(input.audience);
    const recipients = [...new Set([me().id, ...ids.filter((id) => id !== me().id)])];
    const poll: MockPoll = {
      id: nextPollId++,
      question: input.question.trim(),
      createdBy: me().id,
      closesAt,
      closedAt: null,
      cancelledAt: null,
      recipients,
      votes: new Map<number, PollChoice>(),
    };
    POLLS.push(poll);
    // Как на сервере: «дошло» считает только тех, у кого есть Telegram — а не
    // всех адресатов. Мок без бота не умеет ронять отдельную отправку, поэтому
    // «дошло» здесь равно «мог дойти технически» — тот же потолок, что у
    // `resolveAudience.reachable`.
    const telegramOf = (id: number) => staff().find((e) => e.id === id)?.telegramUserId;
    const delivered = recipients.filter((id) => telegramOf(id) != null).length;
    const unreachable = recipients
      .filter((id) => telegramOf(id) == null)
      .map((id) => staff().find((e) => e.id === id)?.displayName ?? "—");
    return { poll: pollViewOf(poll), delivered, unreachable };
  }

  function pollOrThrow(id: number): MockPoll {
    const p = POLLS.find((x) => x.id === id);
    if (!p) throw new Error("Опрос не найден.");
    return p;
  }

  async function getPoll(id: number): Promise<PollView> {
    await wait();
    return pollViewOf(pollOrThrow(id));
  }

  async function votePoll(id: number, choice: PollChoice): Promise<PollView> {
    await wait();
    const p = pollOrThrow(id);
    if (!isOpenAt(p, clock())) throw new Error("Опрос закрыт.");
    p.votes.set(me().id, choice);
    return pollViewOf(p);
  }

  async function closePoll(id: number): Promise<PollView> {
    await wait();
    const p = pollOrThrow(id);
    p.closedAt = new Date().toISOString();
    return pollViewOf(p);
  }

  async function cancelPoll(id: number): Promise<PollView> {
    await wait();
    const p = pollOrThrow(id);
    p.cancelledAt = new Date().toISOString();
    return pollViewOf(p);
  }

  // --- Места и меню --------------------------------------------------------
  // Тот же приём, что у опросов: правила формы (лимиты, дубли блюд) считает
  // `placeInputSchema` из `@planer/shared`, а не своя копия здесь — иначе
  // DEV-режим однажды пропустил бы то, что сервер отклонит.

  interface MockMenuItem {
    id: number;
    name: string;
    price: number;
    unit: FoodUnit;
    stepGrams: number | null;
  }

  interface MockPlace {
    id: number;
    name: string;
    menu: MockMenuItem[];
    archived: boolean;
  }

  const PLACES: MockPlace[] = [
    {
      id: 1,
      name: "Шаурмечная у метро",
      menu: [
        { id: 1, name: "Шаурма классическая", price: 350, unit: "pcs", stepGrams: null },
        { id: 2, name: "Лаваш с курицей", price: 300, unit: "pcs", stepGrams: null },
      ],
      archived: false,
    },
  ];
  let nextPlaceId = 2;
  let nextMenuItemId = 3;

  async function getFoodPlaces(): Promise<PlaceView[]> {
    await wait();
    return PLACES.filter((p) => !p.archived)
      .map((p) => ({ id: p.id, name: p.name, menu: p.menu.map((m) => ({ ...m })) }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }

  async function saveFoodPlace(id: number | null, input: PlaceInput): Promise<PlaceView> {
    await wait();
    const parsed = placeInputSchema.safeParse(input);
    // Тот же отказ и тот же текст, что у ручки `POST /api/food-places` на
    // сервере — иначе DEV пропустил бы то, что живой сервер отклонит.
    if (!parsed.success) throw new Error("Проверь название, блюда и цены (целые рубли, до 100 000).");
    if (id == null) {
      const menu: MockMenuItem[] = parsed.data.menu.map((m) => ({ id: nextMenuItemId++, name: m.name, price: m.price, unit: m.unit, stepGrams: m.stepGrams }));
      const place: MockPlace = { id: nextPlaceId++, name: parsed.data.name, menu, archived: false };
      PLACES.push(place);
      return { id: place.id, name: place.name, menu: place.menu };
    }
    const place = PLACES.find((p) => p.id === id && !p.archived);
    if (!place) throw new Error("Места больше нет.");
    // Тот же отказ и тот же текст, что у `updatePlace` на сервере: id, которого
    // нет среди ТЕКУЩИХ блюд ЭТОГО места (чужое место или уже архивированное
    // кем-то другим блюдо), не должен молча привязаться правкой.
    const currentIds = new Set(place.menu.map((m) => m.id));
    if (parsed.data.menu.some((m) => m.id != null && !currentIds.has(m.id))) {
      throw new Error("Меню уже поменяли — открой место заново.");
    }
    const menu: MockMenuItem[] = parsed.data.menu.map((m) => ({ id: m.id ?? nextMenuItemId++, name: m.name, price: m.price, unit: m.unit, stepGrams: m.stepGrams }));
    place.name = parsed.data.name;
    place.menu = menu;
    return { id: place.id, name: place.name, menu: place.menu };
  }

  async function archiveFoodPlace(id: number): Promise<void> {
    await wait();
    const place = PLACES.find((p) => p.id === id && !p.archived);
    if (!place) throw new Error("Места больше нет.");
    place.archived = true;
  }

  // --- Заказы еды -----------------------------------------------------------
  // Тот же приём, что у опросов и мест: правила (открыт/закрыт, срок, долг,
  // сводка блюд) считают `isOpenAt`/`debtOf`/`dishSummary`/`orderTotal` из
  // `@planer/shared` — те же функции, что и сервер, а не своя копия здесь.
  // Мок играет за того, кто сейчас `me()` у морды, — как в опросах и обменах, —
  // поэтому позиции всегда его, а не произвольного employeeId.

  interface MockOrderItem {
    id: number;
    employeeId: number;
    menuItemId: number | null;
    name: string;
    price: number;
    qty: number;
    unit: FoodUnit;
    stepGrams: number | null;
  }

  interface MockOrder {
    id: number;
    createdBy: number;
    placeId: number | null;
    note: string | null;
    payHint: string | null;
    title: string | null;
    allowCustom: boolean;
    closesAt: string | null;
    closedAt: string | null;
    cancelledAt: string | null;
    recipients: number[];
    items: MockOrderItem[];
    declines: Set<number>;
  }

  const ORDERS: MockOrder[] = [];
  let nextOrderId = 1;
  let nextOrderItemId = 1;

  /**
   * Отметки «сдал» за заказ еды: ключ `${orderId}:${employeeId}` → чья рука
   * поставила. Тот же приём, что у отметок «сдал» по сборам в мини-аппе и консоли, и тот же счёт
   * через `paymentProgress`, что и на сервере, — мок не считает по-своему.
   */
  const ORDER_PAYMENTS = new Map<string, number>();

  /** Должники заказа — те же правила, что серверный `debtorRows`. */
  function orderDebtorRows(o: MockOrder) {
    return debtors(o.items, o.createdBy).map((d) => {
      const emp = staff().find((e) => e.id === d.employeeId);
      return { employeeId: d.employeeId, displayName: emp?.displayName ?? "—", telegramUserId: emp?.telegramUserId ?? null, amount: d.amount };
    });
  }

  function orderPaymentProgress(o: MockOrder) {
    const marks = [...ORDER_PAYMENTS.entries()]
      .filter(([key]) => key.startsWith(`${o.id}:`))
      .map(([key, markedBy]) => ({ employeeId: Number(key.split(":")[1]), markedBy }));
    return paymentProgress(orderDebtorRows(o), marks);
  }

  function orderViewOf(o: MockOrder): OrderView {
    const now = clock();
    const place = o.placeId == null ? null : (PLACES.find((p) => p.id === o.placeId) ?? null);
    const open = isOpenAt(o, now);
    const manage = o.createdBy === me().id || me().isAdmin;
    const mine = o.items.filter((i) => i.employeeId === me().id);
    const responded = new Set<number>([...o.items.map((i) => i.employeeId), ...o.declines]);
    return {
      id: o.id,
      creatorId: o.createdBy,
      creatorName: nameOf(o.createdBy),
      placeId: o.placeId,
      title: o.title,
      placeName: place?.name ?? null,
      allowCustom: o.allowCustom,
      // Меню — только пока приём идёт: у закрытого заказа кнопки добавлять уже нечего.
      menu: open && place ? place.menu.map((m) => ({ ...m })) : [],
      note: o.note,
      payHint: o.payHint,
      closesAt: o.closesAt,
      closes: closesLabel(o.closesAt, now.date),
      open,
      closed: o.closedAt != null,
      cancelled: o.cancelledAt != null,
      isCreator: o.createdBy === me().id,
      canManage: manage,
      myItems: mine.map(({ id, name, price, qty, unit, stepGrams }) => ({ id, name, price, qty, unit, stepGrams })),
      myTotal: debtOf(o.items, me().id),
      declined: o.declines.has(me().id),
      recipientCount: o.recipients.length,
      respondedCount: responded.size,
      dishes: dishSummary(o.items),
      total: orderTotal(o.items),
      // Поимённо — только запускающему/админу, как на сервере (`orderView`):
      // сумма коллеги — не общее знание.
      people: manage
        ? o.recipients.map((id) => ({ employeeId: id, displayName: nameOf(id), amount: debtOf(o.items, id), declined: o.declines.has(id),
            items: o.items.filter((i) => i.employeeId === id).map(({ name, price, qty, unit, stepGrams }) => ({ name, price, qty, unit, stepGrams })),
          }))
        : null,
      payment: (() => {
        const progress = orderPaymentProgress(o);
        const amounts = new Map(debtors(o.items, o.createdBy).map((d) => [d.employeeId, d.amount]));
        return {
          myPaid: progress.rows.some((r) => r.employeeId === me().id && r.paid),
          paidCount: progress.paidCount,
          total: progress.total,
          rows: manage ? progress.rows.map((r) => ({ ...r, amount: amounts.get(r.employeeId) ?? 0 })) : null,
        };
      })(),
    };
  }

  async function getOrders(): Promise<OrderView[]> {
    await wait();
    return ORDERS.filter((o) => o.createdBy === me().id || o.recipients.includes(me().id))
      .slice()
      .reverse()
      .map(orderViewOf);
  }

  // Тот же текст, что у `GET /api/orders/:id` (`NOT_FOUND` в `server/src/http/routes/orders.ts`):
  // сервер отвечает одним 404 и на «такого нет», и на «тебе не приходил».
  const ORDER_NOT_FOUND = "Заказ не найден.";

  function orderOrThrow(id: number): MockOrder {
    const o = ORDERS.find((x) => x.id === id);
    if (!o) throw new Error(ORDER_NOT_FOUND);
    return o;
  }

  async function getOrder(id: number): Promise<OrderView> {
    await wait();
    const o = orderOrThrow(id);
    if (o.createdBy !== me().id && !me().isAdmin && !o.recipients.includes(me().id)) {
      throw new Error(ORDER_NOT_FOUND);
    }
    return orderViewOf(o);
  }

  async function createOrder(input: {
    placeId: number | null; title?: string | null; allowCustom?: boolean; note: string | null; payHint: string | null;
    // `closesTime` — прежнее поле мини-аппа (как у `POST /api/orders`): срок на сегодня.
    closesAt?: string | null; closesTime?: string | null; audience: TeamAudience;
  }): Promise<{ order: OrderView } & FoodSendReport> {
    await wait();
    const now = clock();
    const allowCustom = input.allowCustom ?? true;
    // Тот же отказ и тот же текст, что у `POST /api/orders`: сбор без меню и без своих позиций пуст.
    if (input.placeId == null && !allowCustom) throw new Error("Без меню нужны свои позиции — иначе заказать будет нечего.");
    // Тот же формат и тот же календарь, что у схемы `POST /api/orders`: регэксп пропускает 31 сентября.
    if (input.closesAt != null && !(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(input.closesAt) && dateStr.safeParse(input.closesAt.slice(0, 10)).success)) {
      throw new Error("Проверь место, срок и адресатов.");
    }
    const closesAt = input.closesAt ?? closesAtFromTime(input.closesTime ?? null, now.date);
    // Тот же отказ и тот же текст, что у `POST /api/orders` на сервере.
    if (!isFutureClose(closesAt, now)) throw new Error("Время уже прошло — поставь позже или оставь пустым.");
    if (!isWithinCloseHorizon(closesAt, now.date)) throw new Error(`Срок — не дальше ${FOOD_CLOSE_HORIZON_DAYS} дней.`);
    if (input.placeId != null && !PLACES.some((p) => p.id === input.placeId && !p.archived)) {
      throw new Error("Такого места больше нет.");
    }
    const ids = audienceIds(input.audience);
    const recipients = [...new Set([me().id, ...ids.filter((id) => id !== me().id)])];
    // Тот же отказ и тот же текст, что у `resolveAudience`/`POST /api/orders`:
    // считать надо ДО заведения заказа — иначе он рождается без адресатов.
    const telegramOf = (id: number) => staff().find((e) => e.id === id)?.telegramUserId;
    const delivered = recipients.filter((id) => telegramOf(id) != null).length;
    const unreachable = recipients.filter((id) => telegramOf(id) == null).map((id) => nameOf(id));
    if (delivered < 2) throw new Error("Некому отправить: в списке никого, кроме тебя.");
    const order: MockOrder = {
      id: nextOrderId++,
      createdBy: me().id,
      placeId: input.placeId,
      title: input.title?.trim() || null,
      allowCustom,
      note: input.note,
      payHint: input.payHint,
      closesAt,
      closedAt: null,
      cancelledAt: null,
      recipients,
      items: [],
      declines: new Set(),
    };
    ORDERS.push(order);
    return { order: orderViewOf(order), delivered, unreachable };
  }

  /** Общий вход правки позиций: закрыт — дальше делать нечего. Мок играет
   *  только за `me()`, поэтому «чужой заказ» здесь проверять не у кого. */
  function guardOpen(o: MockOrder): void {
    if (!isOpenAt(o, clock())) throw new Error("Приём закрыт.");
  }

  async function addOrderItem(
    id: number,
    input: { menuItemId: number } | { name: string; price: number; qty?: number },
  ): Promise<OrderView> {
    await wait();
    const o = orderOrThrow(id);
    guardOpen(o);
    const parsed = orderItemInputSchema.safeParse(input);
    // Тот же отказ и тот же текст, что у ручки `POST /api/orders/:id/items`.
    if (!parsed.success) throw new Error("Проверь блюдо и цену (целые рубли, до 100 000).");
    const data = parsed.data;
    // Тот же потолок строк, что `addMenuItem`/`addCustomItem` на сервере.
    const tooMany = o.items.filter((i) => i.employeeId === me().id).length >= FOOD_ITEMS_PER_PERSON_MAX;
    const tooManyError = `Больше ${FOOD_ITEMS_PER_PERSON_MAX} позиций — это уже не обед.`;
    if ("menuItemId" in data) {
      const place = o.placeId == null ? null : PLACES.find((p) => p.id === o.placeId);
      const dish = place?.menu.find((m) => m.id === data.menuItemId);
      if (!dish) throw new Error("Этого блюда нет в меню.");
      // Прибавляем к строке с той же ценой — как `addMenuItem` на сервере.
      const same = o.items.find((i) => i.employeeId === me().id && i.menuItemId === data.menuItemId && i.price === dish.price);
      if (same) same.qty += 1;
      else if (tooMany) throw new Error(tooManyError);
      else o.items.push({ id: nextOrderItemId++, employeeId: me().id, menuItemId: data.menuItemId, name: dish.name, price: dish.price, qty: 1, unit: dish.unit, stepGrams: dish.stepGrams });
    } else {
      if (!o.allowCustom) throw new Error("В этом сборе только позиции из списка.");
      if (tooMany) throw new Error(tooManyError);
      o.items.push({ id: nextOrderItemId++, employeeId: me().id, menuItemId: null, name: data.name, price: data.price, qty: data.qty, unit: "pcs", stepGrams: null });
    }
    o.declines.delete(me().id);
    return orderViewOf(o);
  }

  /** Своя позиция или отказ — мок играет только за `me()`, чужих позиций тут нет. */
  function ownItem(o: MockOrder, itemId: number): MockOrderItem {
    const item = o.items.find((i) => i.id === itemId);
    if (!item || item.employeeId !== me().id) throw new Error("Это не твоя позиция.");
    return item;
  }

  async function setOrderItemQty(id: number, itemId: number, qty: number): Promise<OrderView> {
    await wait();
    const o = orderOrThrow(id);
    guardOpen(o);
    // Тот же отказ и тот же текст, что у `PATCH /api/orders/:id/items/:itemId`.
    if (!Number.isInteger(qty) || qty < 1 || qty > FOOD_QTY_MAX) {
      throw new Error(`Количество — от 1 до ${FOOD_QTY_MAX}.`);
    }
    ownItem(o, itemId).qty = qty;
    return orderViewOf(o);
  }

  async function removeOrderItem(id: number, itemId: number): Promise<OrderView> {
    await wait();
    const o = orderOrThrow(id);
    guardOpen(o);
    const item = ownItem(o, itemId);
    o.items.splice(o.items.indexOf(item), 1);
    return orderViewOf(o);
  }

  async function declineOrder(id: number): Promise<OrderView> {
    await wait();
    const o = orderOrThrow(id);
    guardOpen(o);
    o.items = o.items.filter((i) => i.employeeId !== me().id);
    o.declines.add(me().id);
    return orderViewOf(o);
  }

  // Тот же порядок отказов, что у `closeOrder`/`cancelOrder` на сервере: гонка
  // двойного тапа не должна закрывать/отменять заказ дважды
  // и не должна слать вторую сводку — второй вызов получает отказ, а не «ok».
  async function closeOrder(id: number): Promise<OrderView> {
    await wait();
    const o = orderOrThrow(id);
    if (o.cancelledAt != null) throw new Error("Заказ отменён.");
    if (o.closedAt != null) throw new Error("Приём уже закрыт.");
    o.closedAt = new Date().toISOString();
    return orderViewOf(o);
  }

  async function cancelOrder(id: number): Promise<OrderView> {
    await wait();
    const o = orderOrThrow(id);
    if (o.closedAt != null || o.cancelledAt != null) throw new Error("Приём уже закрыт.");
    o.cancelledAt = new Date().toISOString();
    return orderViewOf(o);
  }

  /**
   * Отметка «сдал» за заказ еды — те же отказы и тот же текст, что у серверного
   * `setOrderPaid`. Мок играет только за `me()`, поэтому «виновник» отметки —
   * всегда он: своя галочка ставит его же рукой, чужая — рукой управляющего.
   */
  function markOrderPaid(o: MockOrder, employeeId: number, paid: boolean): void {
    if (o.cancelledAt != null) throw new Error("Заказ отменён — сдавать нечего.");
    if (o.closedAt == null) throw new Error("Сдавать рано: приём ещё идёт.");
    if (!orderDebtorRows(o).some((d) => d.employeeId === employeeId)) throw new Error("Этот человек ничего не должен.");
    const manage = o.createdBy === me().id || me().isAdmin;
    const key = `${o.id}:${employeeId}`;
    if (paid) {
      if (employeeId !== me().id && !manage) throw new Error("Отметить за другого может только тот, кто собирает заказ.");
      if (!ORDER_PAYMENTS.has(key)) ORDER_PAYMENTS.set(key, me().id);
      return;
    }
    const markedBy = ORDER_PAYMENTS.get(key);
    if (markedBy == null) return;
    if (markedBy !== me().id && !manage) throw new Error("Снять отметку может тот, кто её поставил.");
    ORDER_PAYMENTS.delete(key);
  }

  async function setOrderPaid(id: number, paid: boolean): Promise<OrderView> {
    await wait();
    const o = orderOrThrow(id);
    markOrderPaid(o, me().id, paid);
    return orderViewOf(o);
  }

  async function setOrderPaymentFor(id: number, employeeId: number, paid: boolean): Promise<OrderView> {
    await wait();
    const o = orderOrThrow(id);
    markOrderPaid(o, employeeId, paid);
    return orderViewOf(o);
  }

  /** Дожим — тот же порядок отказов, что у HTTP-ручки: права, потом «отменён
   *  ли», потом «закрыт ли». `unpaid`/`unreachable` — тот же смысл, что у
   *  серверного `remindUnpaid`: знаменатель и кого не достучаться поимённо. */
  async function remindOrderUnpaid(id: number): Promise<OrderRemindResult> {
    await wait();
    const o = orderOrThrow(id);
    if (!(o.createdBy === me().id || me().isAdmin)) throw new Error("Напомнить может только тот, кто собирает заказ.");
    if (o.cancelledAt != null) throw new Error("Заказ отменён — напоминать не о чем.");
    if (o.closedAt == null) throw new Error("Сначала закрой приём.");
    const paid = new Set(
      [...ORDER_PAYMENTS.keys()].filter((key) => key.startsWith(`${o.id}:`)).map((key) => Number(key.split(":")[1])),
    );
    const debtorsList = orderDebtorRows(o).filter((d) => !paid.has(d.employeeId));
    const unreachable = debtorsList.filter((d) => d.telegramUserId == null).map((d) => d.displayName);
    return { delivered: debtorsList.length - unreachable.length, unpaid: debtorsList.length, unreachable };
  }

  return {
    getTeamAudience, getPolls, getPoll, createPoll, votePoll, closePoll, cancelPoll,
    getFoodPlaces, saveFoodPlace, archiveFoodPlace,
    getOrders, getOrder, createOrder, addOrderItem, setOrderItemQty, removeOrderItem, declineOrder,
    closeOrder, cancelOrder, setOrderPaid, setOrderPaymentFor, remindOrderUnpaid,
  };
}

export type FoodMock = ReturnType<typeof createFoodMock>;
