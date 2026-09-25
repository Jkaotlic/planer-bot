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
}

/**
 * Что ждёт ответа прямо сейчас — метки на вкладках нижнего меню.
 *
 * Нуль не рисуется: ключ появляется в объекте, только когда есть что показать,
 * а не когда посчитанное число оказалось нулём. Компонент `TabBar` рисует
 * `.tab-badge` по наличию ключа, а не по `> 0`, так что здесь — единственное
 * место, где это решается.
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
  // (сборы не загрузились) — ключа нет вовсе, не ноль.
  if (input.collections) {
    const unpaid = input.collections.filter((c) => !c.paid).length;
    if (unpaid > 0) badges.collections = unpaid;
  }

  return badges;
}
