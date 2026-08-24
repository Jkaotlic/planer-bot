/**
 * С какой вкладки открывается мини-апп.
 *
 * Личная настройка человека: у дежурного это «Смены», у того, кто ведёт график,
 * — «Команда», у админа часто «Админ». Правило живёт в shared, потому что
 * читателей двое: сервер (что вообще принимать в настройку) и мини-апп (какую
 * вкладку показать на старте).
 */

/** Ключи вкладок нижнего меню — те же строки, что у `TabKey` в мини-аппе. */
export const START_TABS = ["mine", "team", "swaps", "weekend", "collections", "admin"] as const;

export type StartTab = (typeof START_TABS)[number];

export function isStartTab(value: unknown): value is StartTab {
  return typeof value === "string" && (START_TABS as readonly string[]).includes(value);
}

/** Кто смотрит — ровно то, чем различается набор вкладок в меню. */
export interface StartTabViewer {
  isAdmin: boolean;
  isObserver: boolean;
}

/** Видна ли эта вкладка такому человеку. Зеркало условий в `TabBar`. */
export function startTabVisible(tab: StartTab, viewer: StartTabViewer): boolean {
  if (tab === "admin") return viewer.isAdmin;
  // Наблюдатель вне обменов и передачи смен: там нет ни одной кнопки, которая
  // сработала бы, поэтому вкладок ему не показывают вовсе.
  if (tab === "swaps" || tab === "weekend") return !viewer.isObserver;
  return true;
}

/**
 * Вкладка, на которой открыть приложение.
 *
 * Порядок важен: ссылка из бота побеждает настройку — кнопки «🤒 Больничный»,
 * «📌 Мероприятие», «📣 Анонс» обещают конкретный экран, и настройка, которая
 * их перебивает, делает кнопку враньём.
 *
 * Недоступная вкладка откатывается на «Смены», а не открывается пустой: роль
 * могли сменить уже после того, как выбор сохранился, да и значение в базе
 * правили руками не раз.
 */
export function startTabFor(input: {
  saved: string | null;
  deeplink: string | null;
  viewer: StartTabViewer;
}): StartTab {
  for (const candidate of [input.deeplink, input.saved]) {
    if (isStartTab(candidate) && startTabVisible(candidate, input.viewer)) return candidate;
  }
  return "mine";
}
