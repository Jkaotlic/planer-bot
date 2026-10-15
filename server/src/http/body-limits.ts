import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { MAX_DOC_BYTES } from "./checklist-doc";

/**
 * Пределы тела запроса для `/api/*` — по прочитанным байтам, а не по заголовку.
 *
 * Процесс один на API и long-polling бота (см. `CLAUDE.md`): тело, которое ручка
 * буферизует целиком, задевает чат всей команды. Прежняя проверка верила
 * `Content-Length`, а chunked-запрос его не шлёт — и проходил к `c.req.json()`
 * любого размера. `bodyLimit` из hono при отсутствии длины считает байты потока
 * и обрывает чтение на пределе.
 *
 * Общий предел маленький, потому что обычное тело здесь — форма из нескольких
 * полей: самое длинное, что шлют фронты, — меню сбора (30 строк × 200 символов,
 * ~12 КБ) и объявление (2000 символов + до 200 адресатов, ~6 КБ). Большие тела
 * перечислены поимённо: каждое исключение — решение, а не умолчание.
 */
export const API_BODY_MAX = 64 * 1024;

/** Текст при общем пределе. Фронты показывают `error` из тела как есть. */
const TOO_LARGE = "Слишком большой запрос";

/** CSV ростера — до 1 МБ, а JSON вокруг него (экранирование, обёртка) раздувает строку; с запасом. */
export const ROSTER_UPLOAD_MAX = 4_000_000;
const ROSTER_TOO_LARGE = "Файл больше 1 МБ — загрузите месяц отдельно";

/**
 * Пачка записей — до 200 штук (`/api/admin/entries/bulk`), у каждой свободные
 * `note`/`title`/`location`. 200 × ~300 байт уже упирались бы в общий предел,
 * поэтому у пачки свой — с запасом на заметки, но всё ещё далеко от мегабайт.
 */
const BULK_ENTRIES_MAX = 512 * 1024;

/**
 * Файл инструкции — `MAX_DOC_BYTES` плюс обёртка multipart (границы, заголовки
 * части, имя файла). Точный размер файла проверяет сама ручка по `file.size` и
 * отвечает своим текстом; этот предел лишь не даёт дочитать то, что ручка всё
 * равно отвергнет.
 */
const CHECKLIST_DOC_MAX = MAX_DOC_BYTES + 64 * 1024;
const CHECKLIST_DOC_TOO_LARGE = `Файл больше ${Math.round(MAX_DOC_BYTES / 1024 / 1024)} МБ — его будут качать полчаса`;

interface Limit {
  maxSize: number;
  error: string;
}

/**
 * Предел для пути, или `null` — ручка ограничивает себя сама.
 *
 * `/api/client-error` — единственный `null`: отчёт о белом экране отвечает 204
 * даже на мусор (см. `client-error.ts`), поэтому 413 ему не годится — он
 * дочитывает свои 4 КБ и бросает остальное (`readTextCapped`).
 */
export function bodyLimitFor(path: string): Limit | null {
  if (path === "/api/client-error") return null;
  if (path === "/api/admin/roster/import/preview" || path === "/api/admin/roster/import/apply") {
    return { maxSize: ROSTER_UPLOAD_MAX, error: ROSTER_TOO_LARGE };
  }
  if (path === "/api/admin/entries/bulk") return { maxSize: BULK_ENTRIES_MAX, error: TOO_LARGE };
  if (/^\/api\/admin\/checklists\/[^/]+\/doc$/.test(path)) {
    return { maxSize: CHECKLIST_DOC_MAX, error: CHECKLIST_DOC_TOO_LARGE };
  }
  return { maxSize: API_BODY_MAX, error: TOO_LARGE };
}

/**
 * Один middleware на весь `/api/*`, а не `bodyLimit` у каждой ручки: ручка,
 * которую завтра добавят и забудут ограничить, получит общий предел сама.
 * Ручки со своим, более жёстким пределом (`/api/my/qr`, 16 КБ) его сохраняют —
 * их `bodyLimit` срабатывает вторым.
 */
export function apiBodyLimit(): MiddlewareHandler {
  return async (c, next) => {
    const limit = bodyLimitFor(c.req.path);
    if (!limit) return next();
    return bodyLimit({ maxSize: limit.maxSize, onError: (ctx) => ctx.json({ error: limit.error }, 413) })(c, next);
  };
}

/**
 * Текст тела, но не больше `max` байт: остальное не читается вовсе.
 *
 * `c.req.text()` с последующим `.slice` сначала буферизовал бы всё тело — а
 * ручка без токена, на которую это рассчитано, как раз та, куда может прийти
 * что угодно. Обрезка может разрезать UTF-8 посреди символа — декодер без
 * `fatal` поставит на его место «�», для строки лога это безвредно.
 */
export async function readTextCapped(request: Request, max: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < max) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = value.subarray(0, max - size);
      parts.push(take);
      size += take.length;
    }
  } finally {
    // Остаток потока бросаем явно — иначе он висел бы недочитанным.
    await reader.cancel().catch(() => {});
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder().decode(joined);
}
