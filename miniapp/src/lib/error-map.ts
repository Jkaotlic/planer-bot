/**
 * Отказ на действие, привязанный к строке, а не к экрану.
 *
 * Мини-апп — один длинный скролл без единого оверлея: блок, нарисованный под
 * заголовком экрана, при нажатии на карточку ниже оказывается за верхним краем,
 * и человек видит только то, что «ничего не произошло». Ровно этот дефект уже
 * ловили у «🔗 Ссылка» (`c4da857`) и у кнопок в строке работника (`8bc62bb`).
 *
 * Хранится так же, как `busy-set.ts`: id → фраза, потому что карточек на экране
 * много и каждая отвечает за себя. Чистые add/remove — переход проверяется без
 * React.
 */
export function withError(errors: ReadonlyMap<number, string>, id: number, message: string): Map<number, string> {
  return new Map(errors).set(id, message);
}

export function withoutError(errors: ReadonlyMap<number, string>, id: number): Map<number, string> {
  const next = new Map(errors);
  next.delete(id);
  return next;
}
