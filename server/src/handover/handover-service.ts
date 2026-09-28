import { shiftsOverlap, canSwap, shiftStartMs } from "@planer/shared";
import type { Db } from "../db/client";
import type { Handover, Shift } from "../db/schema";
import { recordAudit } from "../repo/audit";
import { safeErrorMessage } from "../util/safe-error";
import { reachedNobody, scheduleLink, type AdminAction, type AdminReach } from "../bot/notify";
import { getEmployeeById } from "../repo/employees";
import {
  addDecline,
  createHandover,
  getHandover,
  listDeclines,
  listHandoversForEntry,
  updateHandover,
} from "../repo/handovers";
import { getShift, listShiftsOverlapping, updateShift } from "../repo/shifts";
import { entryLineOf, nameOf } from "../util/message-lines";
import { handoverCandidates } from "./candidates";
import {
  handoverCancelledText,
  handoverClosedText,
  handoverEscalationText,
  handoverFanText,
  handoverOfferText,
  handoverTakenTextForAdmins,
  handoverTakenTextForGiver,
  handoverTakenTextForTaker,
} from "./handover-notice";

/**
 * Where a handover's messages go.
 *
 * An interface rather than a `Bot`, for one reason: a test must be able to see
 * WHO was written to. A message reaching the wrong person is the worst defect
 * this feature can have, and «сколько сообщений ушло» cannot see it.
 */
export interface HandoverMessenger {
  /** A personal offer, with «Беру» / «Не могу» under it. */
  offer(employeeId: number, handoverId: number, text: string): Promise<void>;
  /** The fan-out: the same shift, one «Беру» button, everybody still free. */
  fan(employeeIds: readonly number[], handoverId: number, text: string): Promise<void>;
  /** A plain message with nothing to tap. */
  plain(employeeId: number, text: string): Promise<void>;
  admins(text: string): Promise<void>;
  /** Письмо, которое админ не может себе выключить: смена осталась без человека.
   *  `action` — кнопка «Открыть график» на дату этой смены (см. `notify.ts`). */
  adminsAlways(text: string, action?: AdminAction): Promise<AdminReach>;
}

export interface HandoverDeps {
  db: Db;
  config: { teamTz: string; publicUrl: string };
  messenger: HandoverMessenger;
  /** Часы — ради тестов: «смена уже началась» зависит от момента, а не от даты. */
  now?: () => number;
}

/**
 * Отдавать уже нечего: однодневная смена началась, у многодневной начался
 * последний день.
 */
function isPast(deps: HandoverDeps, shift: Shift): boolean {
  if (shift.start == null) return false;
  const lastDay = { ...shift, date: shift.endDate ?? shift.date };
  return shiftStartMs(lastDay, deps.config.teamTz) <= (deps.now ?? Date.now)();
}

/**
 * Однодневная смена уже началась — отдавать и брать её поздно.
 *
 * Только однодневная: у недельного дежурства «начало» — понедельник, и в среду
 * оно формально «идёт», но остаток недели ещё можно передать (это решает
 * проверка «уже прошла» по `endDate` в `takeHandover`).
 */
function hasStarted(deps: HandoverDeps, shift: Shift): boolean {
  if (shift.start == null || (shift.endDate != null && shift.endDate !== shift.date)) return false;
  return shiftStartMs(shift, deps.config.teamTz) <= (deps.now ?? Date.now)();
}

/** Кнопка «Открыть график» на дату этой смены — у обеих эскалаций ниже. */
function scheduleAction(publicUrl: string, shift: Shift): AdminAction {
  return { text: "📅 Открыть график", webApp: scheduleLink(publicUrl, shift.date) };
}

export type Outcome = { ok: true } | { ok: false; reason: string };

/** The line every message and every journal row uses for this shift. */
function lineOf(shift: Shift): string {
  return entryLineOf(shift);
}

function auditPayload(db: Db, handover: Handover, shift: Shift | undefined, toEmployeeId: number | null) {
  return {
    handoverId: handover.id,
    shiftId: handover.shiftId,
    shiftLine: shift ? lineOf(shift) : null,
    fromEmployeeId: handover.fromEmployeeId,
    fromName: nameOf(db, handover.fromEmployeeId),
    toEmployeeId,
    toName: toEmployeeId != null ? nameOf(db, toEmployeeId) : null,
  };
}

function shiftOf(db: Db, handover: Handover): Shift | undefined {
  return handover.shiftId == null ? undefined : getShift(db, handover.shiftId);
}

/**
 * Every day a sick leave covers, as ISO dates.
 *
 * Local rather than shared: `eachDayIso` in `@planer/shared` does the same, and
 * this file needs the sick leave's own span only.
 */
function daysOf(entry: Shift): string[] {
  const days: string[] = [];
  for (let day = entry.date; day <= (entry.endDate ?? entry.date); ) {
    days.push(day);
    const next = new Date(`${day}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    day = next.toISOString().slice(0, 10);
  }
  return days;
}

/**
 * A sick leave was recorded — open one handover per shift it takes away.
 *
 * One per shift, never one per sick leave: a colleague ready to cover Wednesday
 * must not be forced to take Thursday too, and refusing Thursday must not carry
 * Wednesday away with it.
 *
 * Handovers are born with no addressee: the person is about to choose one in the
 * form. `offeredAt` starts counting from now anyway, so somebody who closes the
 * form and forgets still gets a fan-out three hours later instead of a shift
 * quietly left on a sick person.
 */
export async function startHandovers(
  deps: HandoverDeps,
  input: { sickEntry: Shift; employeeId: number },
): Promise<Handover[]> {
  const { db } = deps;
  const days = daysOf(input.sickEntry);
  const mine = listShiftsOverlapping(db, days[0]!, days[days.length - 1]!).filter(
    (entry) =>
      entry.employeeId === input.employeeId &&
      entry.id !== input.sickEntry.id &&
      // Only real work is handed over. Another absence overlapping the sick leave
      // is not a shift anybody can take, and offering it would read as «возьми
      // мой отпуск».
      entry.category !== "sick_leave" &&
      entry.category !== "vacation" &&
      entry.category !== "business_trip" &&
      entry.category !== "offsite" &&
      // Больничный задним числом: прошедшую или уже идущую смену не отдать никому,
      // а тревога админу «смена без человека» про прошлую среду — шум.
      !isPast(deps, entry),
  );

  // Extending a sick leave runs this again over days that already have offers.
  // Without this, «поболею ещё день» would re-ask the whole team about Wednesday.
  const alreadyOffered = new Set(
    listHandoversForEntry(db, input.sickEntry.id)
      .filter((handover) => handover.status !== "cancelled")
      .map((handover) => handover.shiftId),
  );

  const made: Handover[] = [];
  for (const shift of mine) {
    if (alreadyOffered.has(shift.id)) continue;
    const handover = createHandover(db, {
      shiftId: shift.id,
      fromEmployeeId: input.employeeId,
      sickEntryId: input.sickEntry.id,
      status: "offered",
      offeredToEmployeeId: null,
    });
    // Nobody free at all: the ladder has no rungs left, so the admins are told at
    // once. Waiting three hours for an answer from nobody would be a lie told by
    // the interface.
    if (handoverCandidates(db, shift).length === 0) {
      const escalated = updateHandover(db, handover.id, { status: "fanned", escalatedAt: new Date() })!;
      recordAudit(db, "handover_escalated", input.employeeId, auditPayload(db, escalated, shift, null));
      await deps.messenger.adminsAlways(
        handoverEscalationText(nameOf(db, input.employeeId) ?? "Работник", lineOf(shift), [], 0),
        scheduleAction(deps.config.publicUrl, shift),
      );
      made.push(escalated);
      continue;
    }
    made.push(handover);
  }
  return made;
}

/** The person picked a colleague. */
export async function offerTo(deps: HandoverDeps, handoverId: number, toEmployeeId: number): Promise<Outcome> {
  const { db } = deps;
  const handover = getHandover(db, handoverId);
  if (!handover || (handover.status !== "offered" && handover.status !== "fanned")) {
    return { ok: false, reason: "Передача уже закрыта" };
  }
  const voided = handoverVoidReason(db, handover);
  if (voided) return { ok: false, reason: VOID_REFUSAL[voided] };
  const shift = shiftOf(db, handover)!;
  if (hasStarted(deps, shift)) return { ok: false, reason: STARTED_REFUSAL };
  // The screen filters candidates already; checking again here is not
  // belt-and-braces but the actual guard — the screen is not a defence, it is a
  // convenience, and the request can arrive from anywhere.
  if (!handoverCandidates(db, shift, { excludeIds: listDeclines(db, handoverId) }).some((e) => e.id === toEmployeeId)) {
    return { ok: false, reason: "Этот коллега в это время занят" };
  }

  const updated = updateHandover(db, handoverId, {
    status: "offered",
    offeredToEmployeeId: toEmployeeId,
    offeredAt: new Date(),
  })!;
  recordAudit(db, "handover_offered", handover.fromEmployeeId, auditPayload(db, updated, shift, toEmployeeId));
  await deps.messenger.offer(
    toEmployeeId,
    handoverId,
    handoverOfferText(nameOf(db, handover.fromEmployeeId) ?? "Коллега", lineOf(shift)),
  );
  return { ok: true };
}

/** Nobody in particular any more — everybody still free gets asked. */
export async function fanOut(deps: HandoverDeps, handoverId: number): Promise<Outcome> {
  const { db } = deps;
  const handover = getHandover(db, handoverId);
  if (!handover || (handover.status !== "offered" && handover.status !== "fanned")) {
    return { ok: false, reason: "Передача уже закрыта" };
  }
  const shift = shiftOf(db, handover);
  if (!shift) return { ok: false, reason: "Смены больше нет" };

  const recipients = handoverCandidates(db, shift, { excludeIds: listDeclines(db, handoverId) }).map((e) => e.id);
  const updated = updateHandover(db, handoverId, { status: "fanned", offeredToEmployeeId: null })!;
  recordAudit(db, "handover_fanned", handover.fromEmployeeId, auditPayload(db, updated, shift, null));
  if (recipients.length > 0) {
    await deps.messenger.fan(
      recipients,
      handoverId,
      handoverFanText(nameOf(db, handover.fromEmployeeId) ?? "Коллега", lineOf(shift)),
    );
  }
  return { ok: true };
}

/**
 * Сказать нажавшему «принято» — после решения, но до рассылки.
 *
 * Рассылка — это десятки сообщений по очереди, а Telegram не принимает ответ на
 * нажатие позже ~15 с. Пока бот отвечал в самом конце, у человека крутился
 * спиннер, а опоздавший ответ ронял обработчик раньше, чем тот снимал кнопки.
 * Решение к этому моменту уже в базе, так что сказать «принято» — правда.
 * Сбой ответа рассылку не отменяет: смена уже переехала.
 */
export type OnDecided = () => Promise<unknown>;

async function tellDecided(onDecided: OnDecided | undefined): Promise<void> {
  try {
    await onDecided?.();
  } catch (err) {
    console.error("handover: ответ на нажатие не ушёл:", safeErrorMessage(err));
  }
}

/** «Не могу». */
export async function declineHandover(
  deps: HandoverDeps, handoverId: number, employeeId: number, onDecided?: OnDecided,
): Promise<Outcome> {
  const { db } = deps;
  const handover = getHandover(db, handoverId);
  if (!handover || (handover.status !== "offered" && handover.status !== "fanned")) {
    return { ok: false, reason: "Эту смену уже закрыли" };
  }
  // «Не могу» есть только в личном предложении, а кнопка в чате живёт вечно.
  // Без этих двух проверок второй тап (или старое сообщение, нажатое после
  // веера) снова рассылал смену всей команде, а отказ по предложению, которое
  // админ уже переадресовал другому, отбирал смену и у нового адресата.
  if (handover.status === "fanned") return { ok: false, reason: "Уже спросили всех — спасибо" };
  if (handover.offeredToEmployeeId !== employeeId) return { ok: false, reason: "Это предложение уже ушло другому" };
  const shift = shiftOf(db, handover);
  addDecline(db, handoverId, employeeId);
  recordAudit(db, "handover_declined", employeeId, auditPayload(db, handover, shift, employeeId));
  await tellDecided(onDecided);
  // Straight to the fan-out: a refusal is an answer, and waiting out the silence
  // window after it would burn three hours on a question already answered.
  await fanOut(deps, handoverId);
  return { ok: true };
}

/**
 * «Беру».
 *
 * The claim and the move are ONE synchronous transaction, and it completes
 * BEFORE a single message is sent. This repository has already paid twice for
 * the other order — the birthday broadcast and the vacant-slot double post both
 * spammed the whole team, and both had the same shape: a status guard written
 * AFTER an await. better-sqlite3 is synchronous and this is one process, so a
 * claim that finishes before the first await cannot be raced.
 *
 * The double-booking check lives inside that transaction too: hours passed since
 * the offer went out, and «свободен» stops being true without warning.
 */
export async function takeHandover(
  deps: HandoverDeps, handoverId: number, employeeId: number, today: string, onDecided?: OnDecided,
): Promise<Outcome> {
  const { db } = deps;
  const claimed = db.transaction(() => {
    const handover = getHandover(db, handoverId);
    if (!handover || (handover.status !== "offered" && handover.status !== "fanned")) {
      return { ok: false as const, reason: "Уже забрали или предложение отменили" };
    }
    // Смена могла уйти от дающего, пока сообщение висело в чате: админ поставил
    // её другому, обмен, укороченный больничный. Без этой проверки «Беру»
    // отбирало смену у нового хозяина молча — письма уходили дающему.
    const voided = handoverVoidReason(db, handover);
    if (voided) return { ok: false as const, reason: VOID_REFUSAL[voided] };
    const shift = shiftOf(db, handover)!;

    // «Беру» живёт в чате вечно. Без этих двух проверок кнопка под старым
    // сообщением брала смену человеку, которого админ тем временем вывел из
    // обменов, или переносила во «взято» смену, которая уже прошла.
    const taker = getEmployeeById(db, employeeId);
    if (!taker || !canSwap(taker)) {
      return { ok: false as const, reason: "Ты сейчас не участвуешь в обменах — смену взять нельзя" };
    }
    // `endDate` — не `date`: диапазоном пишется только отпуск, больничный и
    // командировка (`entrySpanError`), и у такой записи `date` остаётся первым
    // днём всей полосы. Сравнение по одному `date` гасило бы передачу смены на
    // ещё идущий остаток полосы, как будто она уже прошла.
    if ((shift.endDate ?? shift.date) < today) {
      return { ok: false as const, reason: "Эта смена уже прошла" };
    }
    if (hasStarted(deps, shift)) return { ok: false as const, reason: STARTED_REFUSAL };

    const clash = listShiftsOverlapping(db, shift.date, shift.endDate ?? shift.date).some(
      (mine) =>
        mine.employeeId === employeeId &&
        mine.id !== shift.id &&
        (mine.start == null || mine.end == null || shift.start == null || shift.end == null
          ? true
          : shiftsOverlap(
              { date: mine.date, start: mine.start, end: mine.end },
              { date: shift.date, start: shift.start, end: shift.end },
            )),
    );
    if (clash) return { ok: false as const, reason: "У тебя в это время уже стоит своя смена" };

    updateShift(db, shift.id, { employeeId });
    const updated = updateHandover(db, handoverId, {
      status: "taken",
      takenByEmployeeId: employeeId,
      resolvedAt: new Date(),
    })!;
    return { ok: true as const, handover: updated, shift };
  });

  if (!claimed.ok) return claimed;
  await tellDecided(onDecided);

  // Everything below is I/O and may fail. The shift has already moved — the part
  // that must not depend on Telegram being reachable.
  const line = lineOf(claimed.shift);
  const takerName = nameOf(db, employeeId) ?? "Коллега";
  const giverName = nameOf(db, claimed.handover.fromEmployeeId) ?? "Коллега";
  recordAudit(db, "handover_taken", employeeId, auditPayload(db, claimed.handover, claimed.shift, employeeId));
  await deps.messenger.plain(employeeId, handoverTakenTextForTaker(line));
  await deps.messenger.plain(claimed.handover.fromEmployeeId, handoverTakenTextForGiver(takerName, line));
  await deps.messenger.admins(handoverTakenTextForAdmins(takerName, giverName, line));
  return { ok: true };
}

/** The admins are told the shift is still uncovered. Once, not every five minutes. */
export async function escalate(deps: HandoverDeps, handoverId: number): Promise<Outcome> {
  const { db } = deps;
  const handover = getHandover(db, handoverId);
  if (!handover || (handover.status !== "offered" && handover.status !== "fanned")) {
    return { ok: false, reason: "Передача уже закрыта" };
  }
  const shift = shiftOf(db, handover);
  if (!shift) return { ok: false, reason: "Смены больше нет" };

  const declinedIds = listDeclines(db, handoverId);
  const declinedNames = declinedIds.map((id) => getEmployeeById(db, id)?.displayName ?? `работник #${id}`);
  const silent = handoverCandidates(db, shift, { excludeIds: declinedIds }).length;

  // Отметка до отправки — против второго письма, если тик пересечётся сам с
  // собой. Но письмо, не дошедшее ни до кого (обрыв сети), — не сказанное:
  // отметку снимаем, иначе следующий тик промолчит, а `expireHandover` потом
  // промолчит тоже, «потому что админы уже знают».
  const updated = updateHandover(db, handoverId, { escalatedAt: new Date() })!;
  const reach = await deps.messenger.adminsAlways(
    handoverEscalationText(
      nameOf(db, handover.fromEmployeeId) ?? "Работник",
      lineOf(shift),
      declinedNames,
      silent,
    ),
    scheduleAction(deps.config.publicUrl, shift),
  );
  if (reachedNobody(reach)) {
    updateHandover(db, handoverId, { escalatedAt: null });
    return { ok: false, reason: "Письмо админам не дошло" };
  }
  recordAudit(db, "handover_escalated", null, auditPayload(db, updated, shift, null));
  return { ok: true };
}

/**
 * The shift started and nobody took it. Silent by design — the admins already know.
 *
 * Однодневная смена, всё ещё стоящая на дающем, с него снимается — «Не
 * назначено» (решение владельца от 2026-09-28). Иначе больной числился
 * отработавшим в отчёте, а в сетке не было дыры, которую админ ищет глазами.
 * Многодневную не трогаем: снять неделю из-за одного дня больничного значило
 * бы оставить без человека и дни, которые он отработает.
 */
export function expireHandover(deps: HandoverDeps, handoverId: number): void {
  const { db } = deps;
  const unassigned = db.transaction(() => {
    const handover = getHandover(db, handoverId);
    if (!handover) return undefined;
    updateHandover(db, handoverId, { status: "expired", resolvedAt: new Date() });
    const shift = shiftOf(db, handover);
    if (!shift || shift.employeeId !== handover.fromEmployeeId) return undefined;
    if (shift.endDate != null && shift.endDate !== shift.date) return undefined;
    updateShift(db, shift.id, { employeeId: null });
    return { handover, shift };
  });
  if (unassigned) {
    recordAudit(db, "handover_unassigned", null, auditPayload(db, unassigned.handover, unassigned.shift, null));
  }
}

/**
 * Cut the handovers loose from a sick leave that is about to be deleted.
 *
 * `sickEntryId` is a foreign key, so the entry row cannot go while handovers
 * point at it — the delete fails with `invalid_reference`, which is how this was
 * found. Nulling the pointer rather than deleting the handovers is the same
 * choice already made for `shiftId`: the row must outlive what it pointed at,
 * because «Аня отдавала эту смену, и её никто не взял» stays true after the sick
 * leave is gone.
 *
 * Call AFTER cancelling, never instead of it: this only unlinks, it tells nobody.
 */
export function detachHandoversFromEntry(db: Db, sickEntryId: number): void {
  for (const handover of listHandoversForEntry(db, sickEntryId)) {
    updateHandover(db, handover.id, { sickEntryId: null });
  }
}

/**
 * «Выходить не нужно» — тому, кто ждал решения по этой передаче.
 *
 * Кто ждал: адресат личного предложения или, если уже спросили всех, каждый, кто
 * ещё мог её взять. Круг веера пересчитывается, а не хранится: кто с тех пор
 * стал занят, про предложение, которое уже не мог принять, не услышит.
 *
 * Нынешнему хозяину смены не пишем никогда: если админ поставил её тому самому
 * человеку, которому её предлагали, «выходить не нужно» было бы ровно обратным
 * правде. `text` — какой «отбой»: больной снял больничный или смену закрыл админ.
 */
async function tellCancelled(deps: HandoverDeps, handover: Handover, shift: Shift, text: string): Promise<void> {
  const { db } = deps;
  const waiting =
    handover.status === "offered" && handover.offeredToEmployeeId != null
      ? [handover.offeredToEmployeeId]
      : handover.status === "fanned"
        ? handoverCandidates(db, shift, { excludeIds: listDeclines(db, handover.id) }).map((e) => e.id)
        : [];
  for (const employeeId of waiting) {
    if (employeeId === shift.employeeId) continue;
    await deps.messenger.plain(employeeId, text);
  }
}

/** «Отбой» по отменённому больничному — от лица больного. */
function sickCancelledText(db: Db, handover: Handover, shift: Shift): string {
  return handoverCancelledText(nameOf(db, handover.fromEmployeeId) ?? "Коллега", lineOf(shift));
}

/** Почему передача больше не имеет смысла; `null` — жива. */
export type VoidReason = "gone" | "reassigned" | "uncovered";

/**
 * Передача жива, только пока её смена есть, смена всё ещё у дающего, а
 * больничный, ради которого её отдают, существует и покрывает её день.
 *
 * Правило у самой передачи, а не в путях, меняющих смену: таких путей восемь
 * (правка и удаление админом, диапазон, обмен в API и в боте, архивация,
 * выходные, импорт), часть из них синхронна и без бота. Пока «Беру» верило
 * передаче на слово, кнопка под старым сообщением отбирала смену у того, кому
 * админ её уже поставил. Девятый путь, добавленный позже, забыл бы про вызов —
 * а спросить у передачи не может забыть никто.
 *
 * Вернуть смену больной — значит вернуть передаче смысл: правило смотрит на то,
 * что есть сейчас, а не на историю правок.
 */
export function handoverVoidReason(db: Db, handover: Handover): VoidReason | null {
  const shift = shiftOf(db, handover);
  if (!shift) return "gone";
  if (shift.employeeId !== handover.fromEmployeeId) return "reassigned";
  const sick = handover.sickEntryId == null ? undefined : getShift(db, handover.sickEntryId);
  if (!sick) return "gone";
  // Пересечение промежутков, а не «дата смены внутри больничного»: недельное
  // дежурство с понедельника при больничном со среды — та же передача, и
  // `shift.date` у него остаётся понедельником всю неделю.
  if ((shift.endDate ?? shift.date) < sick.date || shift.date > (sick.endDate ?? sick.date)) return "uncovered";
  return null;
}

const STARTED_REFUSAL = "Эта смена уже началась";

/** Что сказать нажавшему «Беру» или «предложить», когда передача мертва. */
export const VOID_REFUSAL: Record<VoidReason, string> = {
  gone: "Смены больше нет — её изменил админ",
  reassigned: "Смену уже переназначили",
  uncovered: "Больничный на этот день сняли — смена снова у коллеги",
};

/**
 * Погасить мёртвую передачу и сказать «отбой» тем, кто ждал.
 *
 * У `"gone"` писем нет: назвать удалённую смену нечем, а «Беру» под старым
 * сообщением само ответит, что смены больше нет.
 */
export async function voidHandover(deps: HandoverDeps, handoverId: number, reason: VoidReason): Promise<void> {
  const { db } = deps;
  const handover = getHandover(db, handoverId);
  if (!handover || (handover.status !== "offered" && handover.status !== "fanned")) return;
  const shift = shiftOf(db, handover);
  const updated = updateHandover(db, handoverId, { status: "cancelled", resolvedAt: new Date() })!;
  recordAudit(db, "handover_cancelled", handover.fromEmployeeId, { ...auditPayload(db, updated, shift, null), reason });
  if (!shift || reason === "gone") return;
  // «Больничный сняли» — правда только у `uncovered`; переназначение — дело админа.
  const text = reason === "uncovered" ? sickCancelledText(db, handover, shift) : handoverClosedText(lineOf(shift));
  await tellCancelled(deps, handover, shift, text);
}

/**
 * The sick leave went away, or shrank — kill the handovers it no longer justifies.
 *
 * `stillCoveredDates` is what the sick leave covers NOW: empty when it was
 * removed outright. A handover whose day is still covered stays alive, so
 * shortening a sick leave by one day does not cancel the other days' offers.
 *
 * Taken handovers are left alone on purpose. That shift already has an owner and
 * is in their schedule; «не выходи» after the fact would be a message about
 * something that is no longer true.
 */
export async function cancelHandoversForEntry(
  deps: HandoverDeps,
  sickEntryId: number,
  stillCoveredDates: readonly string[],
): Promise<number> {
  const { db } = deps;
  const covered = new Set(stillCoveredDates);
  let killed = 0;

  for (const handover of listHandoversForEntry(db, sickEntryId)) {
    if (handover.status !== "offered" && handover.status !== "fanned") continue;
    const shift = shiftOf(db, handover);
    if (shift && covered.has(shift.date)) continue;

    const updated = updateHandover(db, handover.id, { status: "cancelled", resolvedAt: new Date() })!;
    recordAudit(db, "handover_cancelled", handover.fromEmployeeId, auditPayload(db, updated, shift, null));
    killed += 1;
    if (!shift) continue;

    await tellCancelled(deps, handover, shift, sickCancelledText(db, handover, shift));
  }
  return killed;
}
