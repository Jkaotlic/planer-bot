/**
 * Кнопка в карточке: действие, потом перечитывание списка.
 *
 * Раньше оба шага стояли в одном `try`, и оборванное перечитывание выглядело
 * как отказ действия: обмен уже принят, а на экране «Не получилось принять».
 * Человек жал снова и получал настоящий отказ — кнопка казалась сломанной.
 * Здесь это два разных исхода с двумя разными ответами.
 */
export async function runRowAction(steps: {
  action: () => Promise<void>;
  refresh: () => Promise<void>;
  onActionFailed: (err: unknown) => void;
  onRefreshFailed: (err: unknown) => void;
}): Promise<void> {
  try {
    await steps.action();
  } catch (err) {
    steps.onActionFailed(err);
    return;
  }
  try {
    await steps.refresh();
  } catch (err) {
    steps.onRefreshFailed(err);
  }
}
