import { redactSecrets } from "./safe-error";

/**
 * Что уходит в лог, когда падение никто не поймал.
 *
 * Все ошибки, которые мы ловим сами, идут через `safeErrorMessage` — он вырезает
 * токен бота. Мимо редактора шёл ровно один путь: дамп НЕОБРАБОТАННОГО
 * исключения печатает сам Node, и в этом дампе лежит полный URL запроса к
 * Telegram, то есть боевой токен открытым текстом (одна такая строка в
 * `~/planer-bot.log` уже была — историческая, от падения на старте).
 *
 * Печатается стек, а не только сообщение: дамп затем и нужен, чтобы понять, где
 * упало. Склейки пробелов здесь нет по той же причине — в отличие от
 * `safeErrorMessage`, который делает из ошибки одну строку лога.
 */
export function fatalLine(kind: "uncaughtException" | "unhandledRejection", error: unknown): string {
  const body = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return `fatal ${kind}: ${redactSecrets(body)}`;
}

/**
 * Ставит редактор на оба необработанных пути — и оставляет поведение прежним:
 * лог, потом смерть процесса.
 *
 * Проглотить падение было бы хуже утечки, ради которой всё это делается. Node по
 * умолчанию роняет процесс и на исключение, и на отказ обещания, а LaunchDaemon
 * с `KeepAlive` поднимает его заново — 12 августа именно так сервис и выжил после
 * kernel panic: первая попытка умерла на `getaddrinfo ENOTFOUND api.telegram.org`,
 * вторая поднялась. Обработчик без выхода превратил бы это в живой процесс с
 * мёртвым long-polling'ом, которого никто не поднимет и никто не заметит.
 */
export function installFatalHandlers(
  deps: { log?: (line: string) => void; exit?: (code: number) => void } = {},
): void {
  const log = deps.log ?? ((line: string) => console.error(line));
  const exit = deps.exit ?? ((code: number) => process.exit(code));

  process.on("uncaughtException", (error) => {
    log(fatalLine("uncaughtException", error));
    exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    log(fatalLine("unhandledRejection", reason));
    exit(1);
  });
}
