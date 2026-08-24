/**
 * Кто какие виды смен может брать — правила, общие для мини-аппа и консоли.
 *
 * Здесь, а не на экранах: «Кто что может» нарисован на двух фронтах, и любое из
 * этих правил, посчитанное дважды, однажды разъедется. Уже разъезжалось —
 * `poolSummary` и `toggleId` жили копиями в обоих экранах.
 */

/** Минимум, который правилам нужен от вида смены. */
export interface KindRolesLike {
  templateId: number;
  name: string;
  /** Кто допущен. Пустой список значит «допущены все». */
  pool: readonly number[];
  /** employeeId -> вес. Отсутствие значит «не просил». */
  preference: Readonly<Record<number, number>>;
}

/** Один вид смены глазами одного человека — строка в его карточке. */
export interface PersonKindRole {
  templateId: number;
  name: string;
  allowed: boolean;
  preferred: boolean;
  /** Пул не настроен: галочка стоит не потому, что человека выбрали, а потому что берут все. */
  poolIsEmpty: boolean;
}

/**
 * An empty pool is an unconfigured one: everybody may take the slot.
 *
 * Exported because this one line is the whole difference between «этот вид могут
 * только эти люди» and «может любой», and it is asked in three places — очередь
 * дежурств на сервере и экран ролей на обоих фронтах.
 */
export function allowedByPool(pool: readonly number[] | null | undefined, employeeId: number): boolean {
  return !pool || pool.length === 0 || pool.includes(employeeId);
}

/** Виды смен глазами человека, в том же порядке, в каком они пришли. */
export function rolesOfPerson(roles: readonly KindRolesLike[], employeeId: number): PersonKindRole[] {
  return roles.map((kind) => ({
    templateId: kind.templateId,
    name: kind.name,
    allowed: allowedByPool(kind.pool, employeeId),
    preferred: Boolean(kind.preference[employeeId]),
    poolIsEmpty: kind.pool.length === 0,
  }));
}

/**
 * Галочка «допущен» глазами человека, с двумя переходами, которых нет в модели.
 *
 * Модель хранит список допущенных, а экран показывает галочку: пустой список
 * рисуется отмеченным у всех. Поэтому снятие первой галочки не «убирает из
 * пустого списка» — это ничего бы не изменило, — а МАТЕРИАЛИЗУЕТ список: все
 * активные, кроме этого человека. Обратный переход столь же важен: когда
 * отмечены снова все, список СХЛОПЫВАЕТСЯ в пустой, иначе следующий принятый
 * сотрудник молча оказался бы не допущен ни к чему.
 *
 * `null` — отказ: снять последнего допущенного нельзя, пустой список означал бы
 * «допущены все», то есть ровно обратное намерению.
 */
export function toggleAllowed(
  pool: readonly number[],
  employeeId: number,
  activeIds: readonly number[],
): number[] | null {
  if (pool.length === 0) return activeIds.filter((id) => id !== employeeId);
  if (pool.includes(employeeId)) {
    const next = pool.filter((id) => id !== employeeId);
    return next.length === 0 ? null : next;
  }
  const next = [...pool, employeeId];
  // Сравнение по активным, а не по длине: id уволенного, застрявший в списке,
  // иначе навсегда запретил бы схлопывание.
  return activeIds.every((id) => next.includes(id)) ? [] : next;
}

/** Галочка «любит». Вес чужой записи не трогается: он приходит из базы и бывает больше единицы. */
export function togglePreference(
  preference: Readonly<Record<number, number>>,
  employeeId: number,
): Record<number, number> {
  const next = { ...preference };
  if (next[employeeId]) delete next[employeeId];
  else next[employeeId] = 1;
  return next;
}
