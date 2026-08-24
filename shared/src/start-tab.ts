/**
 * С какой вкладки открывается мини-апп.
 *
 * Личная настройка человека: у дежурного это «Смены», у того, кто ведёт график,
 * — «Команда», у админа часто «Админ». Правило живёт в shared, потому что
 * читателей двое: сервер (что вообще принимать в настройку) и мини-апп (какую
 * вкладку показать на старте).
 */

/**
 * Что можно выбрать стартовым экраном.
 *
 * Почти всё — ключи вкладок нижнего меню, те же строки, что у `TabKey` в
 * мини-аппе. Исключение одно: `team_week` — не седьмая вкладка, а «Команда»,
 * открытая сразу недельной сеткой. Тем, кто ведёт график, нужна именно неделя,
 * а вкладка по умолчанию показывает день, и «запинить» неделю до этого было
 * нечем. Разбирается на вкладку и вид `startTabScreen`/`startTabTeamWeek`.
 */
export const START_TABS = ["mine", "team", "team_week", "swaps", "weekend", "collections", "admin"] as const;

export type StartTab = (typeof START_TABS)[number];

/** Вкладка меню, на которой живёт этот стартовый экран. */
export type StartTabScreen = Exclude<StartTab, "team_week">;

export function startTabScreen(tab: StartTab): StartTabScreen {
  return tab === "team_week" ? "team" : tab;
}

/** Открывать ли «Команду» сразу недельной сеткой, а не днём. */
export function startTabTeamWeek(tab: StartTab | string | null): boolean {
  return tab === "team_week";
}

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
  // «Команда — неделя» — та же вкладка «Команда», значит и правило то же.
  if (tab === "team_week") return startTabVisible("team", viewer);
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
