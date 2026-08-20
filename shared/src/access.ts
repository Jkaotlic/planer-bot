/**
 * Что человеку можно, исходя из его роли.
 *
 * Единственное место, где `isObserver` превращается в поведение. До него
 * «вне раздачи» и «вне обменов» были двумя независимыми галочками, которые
 * ставил админ по случаю, и роль, собранная из галочек, разъезжается: снятая
 * по невнимательности одна из них молча возвращает человека в раздачу смен.
 *
 * Функции принимают `Pick<...>`, а не строку работника целиком: их зовут и с
 * рядом из базы, и с DTO мини-аппа, и с литералом в тесте, и ни одному из них
 * не нужно знать про телефоны и инвайт-токены.
 */
export interface AccessSubject {
  isAdmin: boolean;
  isObserver: boolean;
  selfScheduleEnabled: boolean;
  excludedFromAssignment: boolean;
  excludedFromSwaps: boolean;
}

/**
 * Кто может разослать объявление.
 *
 * Право узкое не по привычке: объявление — единственный поток в системе,
 * проходящий сквозь ВСЕ настройки тишины, и отписаться от него нельзя
 * (см. `announcement-service.ts`). Наблюдатель получает его потому, что ради
 * его сообщений роль и заводилась.
 */
export function canAnnounce(e: Pick<AccessSubject, "isAdmin" | "isObserver">): boolean {
  return e.isAdmin || e.isObserver;
}

/** Берёт ли его «Распределить честно», ★-очередь и назначение выходных. */
export function takesPartInAssignment(e: Pick<AccessSubject, "isObserver" | "excludedFromAssignment">): boolean {
  return !e.isObserver && !e.excludedFromAssignment;
}

/** Может ли он участвовать в обмене и быть кандидатом на чужую смену — обе стороны. */
export function canSwap(e: Pick<AccessSubject, "isObserver" | "excludedFromSwaps">): boolean {
  return !e.isObserver && !e.excludedFromSwaps;
}

/** Может ли он поставить себе смену сам. Роль плюс личное решение — не одно вместо другого. */
export function canAddOwnShifts(e: Pick<AccessSubject, "isObserver" | "selfScheduleEnabled">): boolean {
  return e.isObserver && e.selfScheduleEnabled;
}
