import type { SwapRequest, WeekendOffer, WorkerCollection } from "../api/client";
import type { TabKey } from "../components/TabBar";
import { splitSwaps } from "./swaps";

export interface TabBadgesInput {
  swaps: SwapRequest[];
  weekendOffers: WeekendOffer[];
  /** `null` — сборы ещё не загрузились (или запрос упал): метка молчит, а не
   *  врёт нулём. Отличие от «загружены и пусто» важно только здесь. */
  collections: WorkerCollection[] | null;
  /** Команда, не браузер — `teamNow(config.teamTz).today` уже пришёл в `data`
   *  вместе с «моими сменами», см. `App.tsx`. */
  today: string;
  /** У админа «Сборы» — консоль, которой он их ведёт (`AdminCollections`), а
   *  не список с кнопкой «Я перевёл» (`TeamCollections`): отмечаться там не
   *  за что, и метка на этой вкладке была бы про кнопку, которой у него нет. */
  isAdmin?: boolean;
}

/**
 * Что ждёт ответа прямо сейчас — метки на вкладках нижнего меню.
 *
 * Ноль не рисуется: эта функция никогда не кладёт в результат счётчик,
 * равный нулю, — только положительные числа. `TabBar` со своей стороны
 * просто проверяет значение на истинность (`count ? ... : null`); вместе это
 * и даёт «нуль не рисуется», но решает это здесь, один раз, а не на каждой
 * вкладке по-своему.
 */
export function tabBadges(input: TabBadgesInput): Partial<Record<TabKey, number>> {
  const badges: Partial<Record<TabKey, number>> = {};

  // «Обмены»: только входящие pending — свою заявку ждёт коллега, а не ты
  // (`splitSwaps` — то же деление, что показывает сам экран «Обмены»).
  const swapsWaiting = splitSwaps(input.swaps).incoming.length;
  if (swapsWaiting > 0) badges.swaps = swapsWaiting;

  // «Выходные»: офферы в статусе `offered`, чья смена ещё не прошла — оффер на
  // вчера ответа уже не ждёт, отвечать поздно, и он не должен звать на вкладку.
  const weekendWaiting = input.weekendOffers.filter(
    (offer) => offer.assignment.status === "offered" && offer.slot.date >= input.today,
  ).length;
  if (weekendWaiting > 0) badges.weekend = weekendWaiting;

  // «Сборы»: чужие сборы, за которые ещё не отметился «я перевёл». `null`
  // (сборы не загрузились) — ключа нет вовсе, не ноль. У админа эта вкладка —
  // другой экран (см. `isAdmin` выше), метки там не бывает вовсе.
  if (input.collections && !input.isAdmin) {
    const unpaid = input.collections.filter((c) => !c.paid).length;
    if (unpaid > 0) badges.collections = unpaid;
  }

  return badges;
}
