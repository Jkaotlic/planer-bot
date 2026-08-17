import { describe, expect, it } from "vitest";
import { fatalLine, installFatalHandlers } from "./fatal-log";

/**
 * Единственный путь, которым боевой токен уезжал в `~/planer-bot.log` открытым
 * текстом: сырой дамп НЕОБРАБОТАННОГО исключения печатает сам Node, а не наш
 * `console.error`, поэтому он идёт мимо `safeErrorMessage`. Одна такая строка в
 * логе уже лежала (29-я из 174, историческая). Файл `-rw-------` и наружу не
 * торчит — но лог уедет в первый же бэкап или в пересылку «посмотри, что там».
 */
const CREDENTIAL = "1234567890:abcdefghijklmnopqrstuvwxyz_ABCDEF";

describe("дамп необработанного падения", () => {
  it("вырезает токен из сообщения", () => {
    const line = fatalLine("uncaughtException", new Error(`request to https://api.telegram.org/bot${CREDENTIAL}/getUpdates failed`));

    expect(line).not.toContain(CREDENTIAL);
    expect(line).toContain("bot[REDACTED_BOT_TOKEN]");
    expect(line).toContain("uncaughtException");
  });

  it("вырезает токен из стека, а не только из сообщения", () => {
    // Node печатает именно стек, и URL запроса попадает в него целиком.
    const error = new Error("fetch failed");
    error.stack = `Error: fetch failed\n    at get (https://api.telegram.org/bot${CREDENTIAL}/getUpdates)`;

    const line = fatalLine("uncaughtException", error);

    expect(line).not.toContain(CREDENTIAL);
    // Стек остаётся читаемым — ради него дамп и печатают.
    expect(line).toContain("at get (");
  });

  it("вырезает токен из отказа, который вообще не Error", () => {
    // `Promise.reject("строка")` — тоже необработанный отказ, и Node печатает её как есть.
    const line = fatalLine("unhandledRejection", `POST https://api.telegram.org/bot${CREDENTIAL}/sendMessage 401`);

    expect(line).not.toContain(CREDENTIAL);
    expect(line).toContain("unhandledRejection");
  });

  it("роняет процесс, как ронял Node: лог и выход с кодом 1", () => {
    // Проглотить падение было бы хуже утечки: 12 августа процесс умер на
    // `getaddrinfo ENOTFOUND api.telegram.org`, KeepAlive поднял его заново, и со
    // второй попытки бот стартовал. Живой процесс с мёртвым long-polling'ом никто
    // бы не поднял и никто бы не заметил.
    const logged: string[] = [];
    const exits: number[] = [];
    installFatalHandlers({ log: (line) => logged.push(line), exit: (code) => exits.push(code) });

    const handlers = ["uncaughtException", "unhandledRejection"] as const;
    const installed = handlers.map((kind) => {
      const handler = process.listeners(kind).at(-1)!;
      handler(new Error(`bot${CREDENTIAL} died`), kind);
      return { kind, handler };
    });
    for (const { kind, handler } of installed) process.removeListener(kind, handler);

    expect(exits).toEqual([1, 1]);
    expect(logged).toHaveLength(2);
    for (const line of logged) expect(line).not.toContain(CREDENTIAL);
  });
});
