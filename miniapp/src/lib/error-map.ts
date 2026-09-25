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

/**
 * Один код отказа оффера на выходной, который стоит показать буквально.
 *
 * Остальные коды (`not_yours`, `not_offered`, `slot_passed`) значат для
 * работника одно и то же — «оффер устарел» — и общей фразы вроде «возможно,
 * её уже забрали» достаточно (см. комментарий у `runSwapAction`/
 * `runOfferAction` в `App.tsx`: код с сервера — не то, что показывают
 * человеку буквально). `not_participating` — другое: человека вывели из
 * раздачи выходных (или сделали наблюдателем), и генерическое «уже забрали»
 * не объясняет, почему кнопка не сработает и при следующей попытке.
 */
export function weekendOfferErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message === "not_participating") {
    return "Ты сейчас не участвуешь в раздаче выходных";
  }
  return fallback;
}
