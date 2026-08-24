/**
 * Кто какие виды смен может брать — правила, общие для мини-аппа и консоли.
 *
 * Здесь, а не на экранах: «Кто что может» нарисован на двух фронтах, и любое из
 * этих правил, посчитанное дважды, однажды разъедется. Уже разъезжалось —
 * `poolSummary` и `toggleId` жили копиями в обоих экранах.
 */

/**
 * An empty pool is an unconfigured one: everybody may take the slot.
 *
 * Exported because this one line is the whole difference between «этот вид могут
 * только эти люди» and «может любой», and it is asked in three places — the
 * server's week fill, the console's roles screen and the Mini App's.
 */
export function allowedByPool(pool: readonly number[] | null | undefined, employeeId: number): boolean {
  return !pool || pool.length === 0 || pool.includes(employeeId);
}
