import type { Bot } from "grammy";
import { eachDayIso, isAbsence, sickExtensionRuns, sickSpanIntersection, type SickApprovalRow, type SickSpan } from "@planer/shared";
import type { Db } from "../db/client";
import type { Handover, Shift } from "../db/schema";
import { getEmployeeById, listAdmins } from "../repo/employees";
import { recordAudit } from "../repo/audit";
import { deleteShift, getShift, listEmployeeShiftsOverlapping } from "../repo/shifts";
import {
  addApprovalMessage,
  claimPendingSickLeave,
  deleteApprovalMessages,
  listApprovalMessages,
  listPendingSickLeaves,
  markApprovalRequested,
  restoreApprovedSpan,
  setApprovedSpan,
} from "../repo/sick-approvals";
import { listHandoversForEntry } from "../repo/handovers";
import { sendTracked } from "../bot/tracked-send";
import { dayAfterLine } from "../schedule/day-summary";
import { safeErrorMessage } from "../util/safe-error";
import { entryAuditPayload, entryLineOf, nameOf } from "../util/message-lines";
import {
  cancelHandoversForEntryDb,
  notifyCancelledHandovers,
  detachHandoversFromEntry,
  startHandovers,
  type HandoverDeps,
  type OnDecided,
} from "../handover/handover-service";
import { createHandoverMessenger } from "../handover/handover-messenger";
import { notifyUser } from "../bot/notify";
import {
  handoverDraftsKeyboard,
  sickApprovalKeyboard,
  sickApprovalText,
  sickExtensionWithdrawnText,
  sickApprovedWorkerText,
  sickRejectedWorkerText,
  type TakenShift,
} from "./sick-approval-text";

export interface SickApprovalDeps extends HandoverDeps {
  /** Null when the bot failed to start: decisions still land, only the letters are skipped. */
  bot: Bot | null;
}

export function sickApprovalDeps(bot: Bot | null, db: Db, config: { teamTz: string; publicUrl: string }): SickApprovalDeps {
  return { db, config, bot, messenger: createHandoverMessenger(bot, db) };
}

export type SickDecision = { ok: true; adminName: string } | { ok: false; status: 404 | 409; text: string };

/**
 * The days an admin is being asked about, as runs — only when what waits is an EXTENSION
 * of an approved span; null for a plain request, which asks about the whole entry.
 */
export function extensionOf(sick: Shift): SickSpan[] | null {
  if (sick.approvedDate == null) return null;
  return sickExtensionRuns({ date: sick.approvedDate, endDate: sick.approvedEndDate }, sick);
}

export function daysAsked(sick: Shift): string[] {
  const runs = extensionOf(sick);
  return runs ? runs.flatMap((run) => eachDayIso(run.date, run.endDate ?? run.date)) : eachDayIso(sick.date, sick.endDate ?? sick.date);
}

/** Per-day «На Вт 6 окт стоят: …» — the same lines the old self-entry notice carried. */
function dayLines(db: Db, sick: Shift): string[] {
  if (sick.employeeId == null) return [];
  return daysAsked(sick)
    .map((date) => dayAfterLine(db, { employeeId: sick.employeeId!, date, keepSilentForEntryId: sick.id, voice: "admins" }))
    .filter((line): line is string => line !== null);
}

export function approvalTextFor(db: Db, sick: Shift): string {
  const owner = sick.employeeId == null ? undefined : getEmployeeById(db, sick.employeeId);
  return sickApprovalText(owner?.displayName ?? "Работник", sick, dayLines(db, sick), owner?.isObserver ?? false, extensionOf(sick));
}

/**
 * Requests whose send loop is still running, and the outcome of any decision taken meanwhile.
 * The loop's closing step must say what REALLY happened to the letters it sent late; the row
 * cannot tell (an extension's ❌ and a withdraw both leave a present, non-pending, approver-less
 * row). Only in-flight ids are recorded, so nothing accumulates.
 */
const inFlight = new Set<number>();
const outcomes = new Map<number, string>();

/**
 * What the last decision on an entry was, for a second press moments later. The row cannot say:
 * a rejected or withdrawn extension leaves the ORIGINAL approver on it, and «Уже подтвердил(а) …»
 * about a decision that was a refusal would be false. Short-lived and pruned on write, so it
 * cannot grow; past the window the stored approver is the best answer there is.
 */
const RECENT_MS = 10 * 60 * 1000;
// Per database handle: ids repeat across databases (tests open many), and a stale name must never cross.
const recentByDb = new WeakMap<Db, Map<number, { text: string; at: number }>>();

function recentOf(db: Db): Map<number, { text: string; at: number }> {
  let map = recentByDb.get(db);
  if (!map) recentByDb.set(db, (map = new Map()));
  return map;
}

function rememberDecision(deps: { db: Db; now?: () => number }, entryId: number, text: string): void {
  const now = (deps.now ?? Date.now)();
  const recent = recentOf(deps.db);
  for (const [id, entry] of recent) if (now - entry.at > RECENT_MS) recent.delete(id);
  recent.set(entryId, { text, at: now });
}

function rememberOutcome(entryId: number, outcome: string): void {
  if (inFlight.has(entryId)) outcomes.set(entryId, outcome);
}

/**
 * Ask the admins. Our own loop over `listAdmins` + `sendTracked` rather than
 * `notifyAdminsAlways`: that one cannot report message ids, and without them the
 * buttons could not be taken away from the others once one admin decides. Like
 * `notifyAdminsAlways` it ignores notice mutes — the hand-over hangs on this letter.
 */
export async function requestApproval(deps: SickApprovalDeps, sick: Shift, approved: SickSpan | null = null): Promise<Shift> {
  // A new round is a new question: the previous round's outcome must not answer it.
  recentOf(deps.db).delete(sick.id);
  const marked = markApprovalRequested(deps.db, sick.id, new Date((deps.now ?? Date.now)()), approved);
  // Gone, or not a sick leave any more: nothing to ask about, and a letter with
  // buttons for a row that does not exist could only produce «Больничного уже нет».
  if (!marked) return sick;
  if (!deps.bot) return marked;
  const text = approvalTextFor(deps.db, marked);
  inFlight.add(marked.id);
  outcomes.delete(marked.id);
  // Letters sent after the row was already gone (the worker deleted it mid-loop): the
  // message-id table cannot hold them (FOREIGN KEY), so they are closed from this list.
  const late: { chatId: number; messageId: number }[] = [];
  try {
    for (const admin of listAdmins(deps.db)) {
      if (admin.telegramUserId == null || admin.id === marked.employeeId) continue;
      const messageId = await sendTracked(deps.bot, admin.telegramUserId, text, sickApprovalKeyboard(marked.id));
      if (messageId == null) continue;
      if (getShift(deps.db, marked.id)) addApprovalMessage(deps.db, marked.id, admin.telegramUserId, messageId);
      else late.push({ chatId: admin.telegramUserId, messageId });
    }
  } finally {
    inFlight.delete(marked.id);
  }
  const decided = outcomes.get(marked.id);
  outcomes.delete(marked.id);
  // An admin may have decided while the loop was still sending: that decision
  // edited only the letters recorded by then, so the ones recorded after it still
  // carry live buttons. Close them with the outcome that did happen.
  const now = getShift(deps.db, marked.id);
  if (decided != null || !now || now.approvalRequestedAt == null) {
    // The recorded outcome, never one inferred from the row; unknown → neutral words.
    const finalText = `${text}\n\n${decided ?? "Решение уже принято"}`;
    await editApprovalMessages(deps, late, finalText);
    await finishApprovalMessages(deps, marked.id, finalText);
  }
  return marked;
}

/** The worker moved the dates of a still-pending sick leave: same letter, new dates, buttons kept. */
export async function redrawApprovalMessages(deps: SickApprovalDeps, sick: Shift): Promise<void> {
  if (!deps.bot) return;
  const text = approvalTextFor(deps.db, sick);
  for (const row of listApprovalMessages(deps.db, sick.id)) {
    // A decision may land while an earlier edit of this loop is in flight: it has already
    // replaced the buttons and dropped the row, and redrawing now would put them back.
    if (!listApprovalMessages(deps.db, sick.id).some((m) => m.chatId === row.chatId && m.messageId === row.messageId)) continue;
    try {
      await deps.bot.api.editMessageText(row.chatId, row.messageId, text, { reply_markup: sickApprovalKeyboard(sick.id) });
    } catch (err) {
      console.error("sick approval: cosmetic redraw failed:", safeErrorMessage(err));
    }
  }
}

/**
 * The dates of a still-pending sick leave were edited (by the worker or by an admin): the one
 * place that decides what the open request becomes. `existing` is the row BEFORE the edit,
 * `updated` the row after it.
 *
 * - An extension edited back inside the approved days has nothing left to ask: withdrawn.
 * - Otherwise the stored approved span shrinks to what the new dates still cover, so a «Отклонить»
 *   never gives back a day that was dropped, and the letters are redrawn in place — a second
 *   letter about the same request would be noise, and its buttons would decide twice.
 */
export async function reconcilePendingDateEdit(deps: SickApprovalDeps, existing: Shift, updated: Shift): Promise<"withdrawn" | "redrawn"> {
  const covered = eachDayIso(updated.date, updated.endDate ?? updated.date);
  const approvedDays =
    existing.approvedDate == null ? null : new Set(eachDayIso(existing.approvedDate, existing.approvedEndDate ?? existing.approvedDate));
  if (approvedDays && covered.every((date) => approvedDays.has(date))) {
    await withdrawExtension(deps, updated);
    return "withdrawn";
  }
  // Empty intersection (or a plain request): no snapshot, so a reject deletes as for any plain request.
  const kept =
    existing.approvedDate == null
      ? null
      : sickSpanIntersection({ date: existing.approvedDate, endDate: existing.approvedEndDate }, updated);
  const fresh = existing.approvedDate == null ? updated : (setApprovedSpan(deps.db, updated.id, kept) ?? updated);
  await redrawApprovalMessages(deps, fresh);
  return "redrawn";
}

/**
 * The worker took the extension back (edited the dates inside the approved span again):
 * nothing is left to ask, so the request closes and every admin's buttons say so. The row
 * stays approved, as it was before the extension.
 */
export async function withdrawExtension(deps: SickApprovalDeps, sick: Shift): Promise<void> {
  // Approver kept: the row goes back to what it was before the extension, and that was approved by someone.
  const cleared = claimPendingSickLeave(deps.db, sick.id);
  if (!cleared) return;
  rememberDecision(deps, sick.id, "Продление уже снято");
  const name = cleared.employeeId == null ? undefined : getEmployeeById(deps.db, cleared.employeeId)?.displayName;
  await finishApprovalMessages(deps, sick.id, `${sickExtensionWithdrawnText(name ?? "Работник", cleared)}\n\n↩️ Продление снято — ОК не нужен`);
}

/**
 * Replace the buttons with the outcome in every admin's copy. Rows are deleted
 * BEFORE editing, so a second decision racing this one finds nothing to edit twice.
 * Cosmetic: an edit failing (message deleted by hand) must not undo the decision.
 */
export async function finishApprovalMessages(deps: SickApprovalDeps, entryId: number, finalText: string): Promise<void> {
  const rows = listApprovalMessages(deps.db, entryId);
  deleteApprovalMessages(deps.db, entryId);
  // The outcome is the last paragraph by convention of every caller.
  rememberOutcome(entryId, finalText.split("\n\n").at(-1) ?? finalText);
  await editApprovalMessages(deps, rows, finalText);
}

/** The letters of a request that was taken out of «pending» for a delete: what to edit, and to what. */
export interface ClosedRequest {
  messages: { chatId: number; messageId: number }[];
  text: string;
}

/**
 * A pending sick leave is about to be deleted by the worker or an admin. The SYNCHRONOUS half:
 * the row leaves «pending» (another admin's «ОК» on a not-yet-edited letter would otherwise win
 * the claim, overwrite «🗑» with «✅» and send the worker a «выбери, кому предложить смены» for a
 * row that is going away) and the letters are snapshotted. The caller then deletes the row in
 * the same synchronous stretch and only afterwards edits the letters from the snapshot — a
 * restart in between must not strand a non-pending row «approved by nobody».
 * Null when the row is not pending.
 */
export function takeRequestOutOfPending(db: Db, existing: Shift, finalLine: string): ClosedRequest | null {
  if (!claimPendingSickLeave(db, existing.id)) return null;
  const messages = listApprovalMessages(db, existing.id);
  deleteApprovalMessages(db, existing.id);
  // A send loop still running for this request closes its late letters with this outcome.
  rememberOutcome(existing.id, finalLine);
  return { messages, text: `${approvalTextFor(db, existing)}\n\n${finalLine}` };
}

/** The Telegram half: replace the buttons in every admin's copy. Cosmetic, never throws. */
export async function editClosedRequest(deps: SickApprovalDeps, closed: ClosedRequest): Promise<void> {
  await editApprovalMessages(deps, closed.messages, closed.text);
}

/** The Telegram half of `finishApprovalMessages`, for a caller that took its snapshot of the rows earlier. */
async function editApprovalMessages(
  deps: SickApprovalDeps,
  rows: readonly { chatId: number; messageId: number }[],
  finalText: string,
): Promise<void> {
  if (!deps.bot) return;
  for (const row of rows) {
    try {
      await deps.bot.api.editMessageText(row.chatId, row.messageId, finalText);
    } catch (err) {
      console.error("sick approval: cosmetic edit failed:", safeErrorMessage(err));
    }
  }
}

/** See `OnDecided` in the handover service: answer the tap before the slow broadcast. */
async function tellDecided(onDecided: OnDecided | undefined): Promise<void> {
  if (!onDecided) return;
  try {
    await onDecided();
  } catch (err) {
    console.error("sick approval: answering the tap failed:", safeErrorMessage(err));
  }
}

/**
 * Why a claim failed, in words a person can act on. A reject in flight (claimed,
 * not yet deleted) reads as «уже подтверждён» for a few milliseconds — acceptable:
 * the presser is told the request is no longer open, which is true.
 */
function refusal(db: Db, entryId: number, now: number): SickDecision {
  const recent = recentOf(db).get(entryId);
  const entry = getShift(db, entryId);
  if (recent && now - recent.at <= RECENT_MS && entry) return { ok: false, status: 409, text: recent.text };
  if (!entry || entry.category !== "sick_leave") return { ok: false, status: 404, text: "Больничного уже нет" };
  const by = entry.approvedByEmployeeId == null ? null : nameOf(db, entry.approvedByEmployeeId);
  return { ok: false, status: 409, text: by ? `Уже подтвердил(а) ${by}` : "Больничный уже подтверждён" };
}

export async function approveSickLeave(
  deps: SickApprovalDeps,
  entryId: number,
  adminId: number,
  onDecided?: OnDecided,
): Promise<SickDecision> {
  const { db } = deps;
  // Read before the claim clears the snapshot: it says which days this «ОК» is about.
  const before = getShift(db, entryId);
  const claimed = claimPendingSickLeave(db, entryId, adminId);
  if (!claimed || !before) return refusal(db, entryId, (deps.now ?? Date.now)());
  const adminName = nameOf(db, adminId) ?? "Админ";
  const extension = extensionOf(before);
  recordAudit(db, "sick_leave_approved", adminId, entryAuditPayload(db, claimed));

  const owner = claimed.employeeId == null ? undefined : getEmployeeById(db, claimed.employeeId);
  // The hand-overs come FIRST, before any Telegram await: every draft row is created right here,
  // synchronously (only the escalation letters inside `startHandovers` await), like a reject's
  // database part. The claim has already made the row look approved, so a
  // restart during the slower letters below must find the drafts in place — nothing would
  // create them later. The promise is kept (not awaited yet) so the tap is still answered at once.
  let started: Promise<Handover[]> | null = null;
  // Observers are out of hand-overs entirely — the same gate as the self-entry route.
  if (owner && !owner.isObserver) {
    // Exactly what a sick leave created today starts (owner's decision): drafts with no
    // addressee for the worker to pick a colleague, and the existing ladder's timer —
    // silence for `handoverFanHours` fans out to everyone free. Idempotent per shift:
    // whatever the urgent branch already handed over is skipped.
    // An extension asks only about its new days: the approved ones already have their hand-overs.
    const onlyDates = extension ? new Set(daysAsked(before)) : undefined;
    started = startHandovers(deps, { sickEntry: claimed, employeeId: owner.id, onlyDates });
    // Handled here so a failure while the tap is being answered is not reported as unhandled;
    // the real `await` below still rethrows it.
    started.catch(() => {});
  }
  await tellDecided(onDecided);
  const made = started ? await started : [];
  await finishApprovalMessages(deps, entryId, `${approvalTextFor(db, before)}\n\n✅ Подтвердил(а) ${adminName}`);

  // The worker may have deleted the row while the letters were being edited. Her
  // hand-overs were cancelled with it, and «✅ подтвердил(а)» about a sick leave she just
  // took back would be false.
  if (!getShift(db, entryId)) return { ok: true, adminName };
  // A shift with nobody free is escalated inside `startHandovers` («fanned» at once);
  // only an «offered» one is a draft the worker can still act on.
  const hasDrafts = made.some((handover) => handover.status === "offered");
  if (owner?.telegramUserId != null && deps.bot) {
    await notifyUser(
      deps.bot,
      owner.telegramUserId,
      sickApprovedWorkerText(claimed, adminName, hasDrafts, extension),
      hasDrafts ? handoverDraftsKeyboard(deps.config.publicUrl) : undefined,
    );
  }
  return { ok: true, adminName };
}

/** One entry per taken hand-over of this sick leave (restricted to `onlyDates` when given), read BEFORE they are detached. */
function takenHandoverLines(db: Db, entryId: number, onlyDates: ReadonlySet<string> | null): TakenShift[] {
  const lines: TakenShift[] = [];
  for (const handover of listHandoversForEntry(db, entryId)) {
    if (handover.status !== "taken" || handover.shiftId == null || handover.takenByEmployeeId == null) continue;
    const shift = getShift(db, handover.shiftId);
    if (!shift || (onlyDates && !onlyDates.has(shift.date))) continue;
    lines.push({ shiftLine: entryLineOf(shift), takerName: nameOf(db, handover.takenByEmployeeId) ?? "Коллега" });
  }
  return lines;
}

export async function rejectSickLeave(
  deps: SickApprovalDeps,
  entryId: number,
  adminId: number,
  onDecided?: OnDecided,
): Promise<SickDecision> {
  const { db } = deps;
  const before = getShift(db, entryId);
  // A rejected extension leaves the original approver in place; a plain request is deleted below anyway.
  const claimed = claimPendingSickLeave(db, entryId);
  if (!claimed || !before) return refusal(db, entryId, (deps.now ?? Date.now)());
  const adminName = nameOf(db, adminId) ?? "Админ";
  rememberDecision(deps, entryId, `Уже отклонил(а) ${adminName}`);
  const extension = extensionOf(before);
  // Hand-overs a colleague already took (the urgent branch): those shifts are no longer the
  // worker's, and the letter must say so instead of leaving her to turn up for them.
  const takenAway = takenHandoverLines(db, entryId, extension ? new Set(daysAsked(before)) : null);
  // The whole database part runs before the first await. After the claim the row looks
  // exactly like an approved one (no request, no approver); leaving it so across Telegram
  // calls would let a restart strand an approved-by-nobody sick leave, and a second admin
  // would be told «уже подтверждён», which is false. So: snapshot, cancel, delete — then talk.
  const payload = entryAuditPayload(db, claimed);
  const letter = approvalTextFor(db, before);
  const messages = listApprovalMessages(db, entryId);
  let cancelled;
  if (before.approvedDate != null) {
    // A rejected EXTENSION gives the row back as it was approved: the old days live on
    // (spec item 13), so only what was started for the new days is cancelled.
    const approved = { date: before.approvedDate, endDate: before.approvedEndDate };
    cancelled = cancelHandoversForEntryDb(db, entryId, eachDayIso(approved.date, approved.endDate ?? approved.date));
    restoreApprovedSpan(db, entryId, approved);
  } else {
    // Whatever the urgent branch started dies the way a worker's own delete kills it.
    // Taken hand-overs stay: that shift already has a new owner (`cancelHandoversForEntry`).
    cancelled = cancelHandoversForEntryDb(db, entryId, []);
    detachHandoversFromEntry(db, entryId);
    // Rows are gone with the sick leave (CASCADE); the snapshot above is what the edits use.
    deleteShift(db, entryId);
  }
  recordAudit(db, "sick_leave_rejected", adminId, payload);
  rememberOutcome(entryId, `❌ Отклонил(а) ${adminName}`);

  await tellDecided(onDecided);
  await editApprovalMessages(deps, messages, `${letter}\n\n❌ Отклонил(а) ${adminName}`);
  await notifyCancelledHandovers(deps, cancelled);
  if (claimed.employeeId != null) {
    await deps.messenger.plain(claimed.employeeId, sickRejectedWorkerText(claimed, adminName, extension, takenAway));
  }
  return { ok: true, adminName };
}

/** Work the sick leave takes away, one line per shift — the list screens show it under the name. */
function sickShiftLines(db: Db, sick: Shift): string[] {
  if (sick.employeeId == null) return [];
  // An extension takes away only the work on its new days.
  const asked = new Set(daysAsked(sick));
  return listEmployeeShiftsOverlapping(db, sick.employeeId, sick.date, sick.endDate ?? sick.date)
    .filter((entry) => entry.id !== sick.id && asked.has(entry.date) && !isAbsence(entry.category) && entry.category !== "offsite")
    .map((entry) => entryLineOf(entry));
}

export function listSickApprovals(db: Db): SickApprovalRow[] {
  return listPendingSickLeaves(db)
    .filter((sick) => sick.employeeId != null && sick.approvalRequestedAt != null)
    .map((sick) => ({
      id: sick.id,
      employeeId: sick.employeeId!,
      employeeName: nameOf(db, sick.employeeId!) ?? "Работник",
      date: sick.date,
      endDate: sick.endDate,
      requestedAt: sick.approvalRequestedAt!.toISOString(),
      shiftLines: sickShiftLines(db, sick),
      handoverForced: sick.handoverForcedAt != null,
      ...(sick.approvedDate != null ? { approvedSpan: { date: sick.approvedDate, endDate: sick.approvedEndDate } } : {}),
    }));
}
