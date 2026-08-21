import { and, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { HONOUREE_AUDIT_TYPES, type AuditType } from "@planer/shared";
import type { Db } from "../db/client";
import { auditLog, employees, type AuditLog } from "../db/schema";

/** Records one thing that happened, for the «кто когда что менял» feed. Never let a
 *  bookkeeping failure take down the action it describes — the write already
 *  succeeded by the time we get here.
 *
 *  `type` — не `string`: каждое событие обязано иметь человеческое описание в
 *  `@planer/shared/audit`, и это единственное место, где такое требование можно
 *  предъявить один раз на весь сервер. */
export function recordAudit(db: Db, type: AuditType, actorEmployeeId: number | null, payload: unknown): void {
  try {
    db.insert(auditLog).values({ type, actorEmployeeId, payload }).run();
  } catch (err) {
    console.error(`failed to record audit "${type}":`, err instanceof Error ? err.message : err);
  }
}

export interface AuditQuery {
  /** Only these event types; empty or absent means every type. */
  types?: readonly string[];
  /** Only events by this person. Rows with a null actor (the bot's own ticks) never
   *  match — `NULL = x` is never true in SQL, which is exactly right here: an
   *  unattributed event has no author to filter by. */
  actorEmployeeId?: number;
  /** Inclusive YYYY-MM-DD bounds on when the event happened. */
  from?: string;
  to?: string;
  limit: number;
  offset?: number;
  /** Who is looking. Events about their own collection are withheld from them —
   *  the surprise rule applies to the journal too, not only to the bot. */
  viewerEmployeeId?: number;
}

export interface AuditPage {
  rows: AuditLog[];
  /** How many match the filter in total — what the screen needs to page through. */
  total: number;
  /** Every type present in the log, so the filter can offer only real options. */
  availableTypes: string[];
  /** Everyone who has ever been the actor of an event, so the person filter offers
   *  only people who actually did something — not the whole roster. */
  availableActors: { id: number; displayName: string }[];
}

/**
 * Правило сюрприза в SQL: строки про сбор, где смотрящий — виновник, не его дело.
 *
 * Одна функция на обоих читателей журнала (`queryAudit` и лента `listRecentAudit`),
 * а не два одинаковых условия: разъехались бы они молча, и именно так это и было —
 * журнал правило применял, лента справа в консоли нет, и админ читал в ней про
 * сбор на собственный день рождения.
 *
 * В SQL, а не после выборки: фильтрация страницы в JS оставила бы `total`
 * считающим строки, которых смотрящий не увидит, и листалка обещала бы ещё
 * страницы там, где их нет.
 *
 * `is`, а не `=`: у общего сбора в payload лежит `employeeId: null`, а в
 * трёхзначной логике SQL `NULL = x` сам по себе NULL, а не false — тогда и
 * `not (...)` становится NULL, который SQLite в WHERE отбрасывает наравне с
 * false, молча пряча строки, которые вообще ни про кого. `is` сравнивает NULL
 * с не-null как обычный false.
 */
function notAboutViewer(viewerEmployeeId: number | undefined) {
  if (viewerEmployeeId == null) return null;
  return sql`not (
    ${auditLog.type} in ${HONOUREE_AUDIT_TYPES}
    and json_extract(${auditLog.payload}, '$.employeeId') is ${viewerEmployeeId}
  )`;
}

/**
 * The «кто когда что менял» history: filtered, counted and paged.
 *
 * A date bound covers that whole day, and `to` is inclusive — which is what a
 * person means by «по 5 августа», and not what a naive `< to` would give them.
 */
export function queryAudit(db: Db, query: AuditQuery): AuditPage {
  const filters = [];
  // `types` пришёл из query-параметра — произвольные строки. Мимо `AuditType`
  // это фильтр «сравни с типом в БД», а не запись: незнакомая строка просто
  // ничему не совпадёт, поэтому кастуем, а не разрешаем в `AuditQuery` любую строку.
  if (query.types && query.types.length > 0) filters.push(inArray(auditLog.type, query.types as AuditType[]));
  if (query.actorEmployeeId != null) filters.push(eq(auditLog.actorEmployeeId, query.actorEmployeeId));
  if (query.from) filters.push(gte(auditLog.createdAt, new Date(`${query.from}T00:00:00Z`)));
  if (query.to) filters.push(lte(auditLog.createdAt, new Date(`${query.to}T23:59:59Z`)));
  const surprise = notAboutViewer(query.viewerEmployeeId);
  if (surprise) filters.push(surprise);
  const where = filters.length > 0 ? and(...filters) : undefined;

  const rows = db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(query.limit)
    .offset(query.offset ?? 0)
    .all();

  const total = db.select({ n: count() }).from(auditLog).where(where).get()?.n ?? 0;
  const availableTypes = db
    .selectDistinct({ type: auditLog.type })
    .from(auditLog)
    .all()
    .map((row) => row.type)
    .sort();
  // Inner join drops null-actor rows on its own — no author, so no place in a
  // person filter. Built from the log itself, not the roster: someone who never
  // touched anything never shows up here, even if they're an active employee.
  const availableActors = db
    .selectDistinct({ id: employees.id, displayName: employees.displayName })
    .from(auditLog)
    .innerJoin(employees, eq(auditLog.actorEmployeeId, employees.id))
    .all()
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ru"));

  return { rows, total, availableTypes, availableActors };
}

/**
 * Последние события для ленты справа в консоли.
 *
 * `viewerEmployeeId` не необязательный довесок, а часть контракта: лента
 * читается конкретным админом, и правило сюрприза действует в ней ровно так же,
 * как в журнале.
 */
export function listRecentAudit(db: Db, limit: number, viewerEmployeeId?: number): AuditLog[] {
  const surprise = notAboutViewer(viewerEmployeeId);
  // createdAt has one-second resolution, so two events in the same second tie. `id`
  // breaks the tie by actual write order — otherwise the feed shows them shuffled.
  return db
    .select()
    .from(auditLog)
    .where(surprise ?? undefined)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit)
    .all();
}
