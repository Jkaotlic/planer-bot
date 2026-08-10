import type { CollectionPatch } from "../collections/collection-service";

/**
 * Turns an untrusted JSON body into a patch, or into the reason it isn't one.
 *
 * A key that was not sent stays absent: an edit must touch only what it names,
 * or saving the link would silently wipe the sum.
 */
export type ParsedCollectionBody =
  | { ok: true; value: CollectionPatch }
  | { ok: false; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MONEY = 10_000_000;

export function parseCollectionBody(raw: unknown, opts: { requireTitle: boolean }): ParsedCollectionBody {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const value: CollectionPatch = {};

  if (body.title !== undefined) {
    if (typeof body.title !== "string") return { ok: false, error: "Повод должен быть текстом" };
    const title = body.title.trim();
    if (title.length === 0) return { ok: false, error: "Повод не может быть пустым" };
    if (title.length > 80) return { ok: false, error: "Повод длиннее 80 символов" };
    value.title = title;
  } else if (opts.requireTitle) {
    return { ok: false, error: "Повод обязателен" };
  }

  if (body.employeeId !== undefined) {
    if (body.employeeId !== null && !Number.isInteger(body.employeeId)) {
      return { ok: false, error: "Виновник должен быть работником или null" };
    }
    value.employeeId = body.employeeId as number | null;
  }

  if (body.collectUrl !== undefined) {
    if (body.collectUrl !== null && typeof body.collectUrl !== "string") {
      return { ok: false, error: "collectUrl должен быть ссылкой или null" };
    }
    const url = typeof body.collectUrl === "string" ? body.collectUrl.trim() : null;
    // Only http(s): the link is forwarded to the whole team, so a `javascript:`
    // or a bare word must not be able to travel in a message from the bot.
    if (url && !/^https?:\/\/\S+$/i.test(url)) {
      return { ok: false, error: "Ссылка должна начинаться с http:// или https://" };
    }
    value.collectUrl = url || null;
  }

  if (body.messageText !== undefined) {
    if (body.messageText !== null && typeof body.messageText !== "string") {
      return { ok: false, error: "messageText должен быть текстом или null" };
    }
    const text = typeof body.messageText === "string" ? body.messageText.trim() : null;
    if (text && text.length > 3000) return { ok: false, error: "Текст длиннее 3000 символов" };
    value.messageText = text || null;
  }

  for (const key of ["amountPerPerson", "totalGoal"] as const) {
    if (body[key] === undefined) continue;
    if (body[key] === null) { value[key] = null; continue; }
    const amount = body[key];
    if (!Number.isInteger(amount) || (amount as number) < 1 || (amount as number) > MAX_MONEY) {
      return { ok: false, error: "Сумма должна быть целым числом рублей от 1 до 10 000 000" };
    }
    value[key] = amount as number;
  }

  for (const key of ["eventDate", "deadline", "scheduledSendOn"] as const) {
    if (body[key] === undefined) continue;
    if (body[key] === null) { value[key] = null; continue; }
    if (typeof body[key] !== "string" || !ISO_DATE.test(body[key] as string)) {
      return { ok: false, error: "Дата должна быть в виде ГГГГ-ММ-ДД" };
    }
    // A date in the past is allowed on purpose: it is not an error, it is the
    // state «this collection is no longer active».
    value[key] = body[key] as string;
  }

  return { ok: true, value };
}

/**
 * The reminder window is «from today up to and including the event».
 *
 * Read the round BEFORE validating: a client that resends this field unchanged
 * on every save (both consoles do) must not get stuck the moment the reminder
 * day is behind us but the event isn't — resubmitting a stored value is not an
 * edit.
 */
export function scheduledSendOnError(
  value: string | null | undefined,
  current: { scheduledSendOn: string | null; celebratedOn: string | null; eventDate: string | null; deadline: string | null },
  asOf: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (value !== current.scheduledSendOn && value < asOf) return "Дата напоминания уже прошла";
  const edge = current.celebratedOn ?? current.deadline ?? current.eventDate;
  if (edge && value > edge) return "Напоминать после самого события уже поздно";
  return null;
}
