import type { Bot } from "grammy";
import { eachDayIso, isAbsence, sickExtensionRuns, type SickApprovalRow, type SickSpan } from "@planer/shared";
import type { Db } from "../db/client";
import type { Shift } from "../db/schema";
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
} from "../repo/sick-approvals";
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
  sickApprovedWorkerText,
  sickRejectedWorkerText,
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

function daysAsked(sick: Shift): string[] {
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
 * Ask the admins. Our own loop over `listAdmins` + `sendTracked` rather than
 * `notifyAdminsAlways`: that one cannot report message ids, and without them the
 * buttons could not be taken away from the others once one admin decides. Like
 * `notifyAdminsAlways` it ignores notice mutes — the hand-over hangs on this letter.
 */
export async function requestApproval(deps: SickApprovalDeps, sick: Shift, approved: SickSpan | null = null): Promise<Shift> {
  const marked = markApprovalRequested(deps.db, sick.id, new Date((deps.now ?? Date.now)()), approved);
  // Gone, or not a sick leave any more: nothing to ask about, and a letter with
  // buttons for a row that does not exist could only produce «Больничного уже нет».
  if (!marked) return sick;
  if (!deps.bot) return marked;
  const text = approvalTextFor(deps.db, marked);
  for (const admin of listAdmins(deps.db)) {
    if (admin.telegramUserId == null || admin.id === marked.employeeId) continue;
    const messageId = await sendTracked(deps.bot, admin.telegramUserId, text, sickApprovalKeyboard(marked.id));
    if (messageId != null) addApprovalMessage(deps.db, marked.id, admin.telegramUserId, messageId);
  }
  // An admin may have decided while the loop was still sending: that decision
  // edited only the letters recorded by then, so the ones recorded after it still
  // carry live buttons. Close them with the outcome that did happen.
  const now = getShift(deps.db, marked.id);
  if (!now || now.approvalRequestedAt == null) {
    const by = now?.approvedByEmployeeId == null ? null : nameOf(deps.db, now.approvedByEmployeeId);
    const outcome = now ? `✅ Подтвердил(а) ${by ?? "админ"}` : "❌ Отклонено";
    await finishApprovalMessages(deps, marked.id, `${text}\n\n${outcome}`);
  }
  return marked;
}

/** The worker moved the dates of a still-pending sick leave: same letter, new dates, buttons kept. */
export async function redrawApprovalMessages(deps: SickApprovalDeps, sick: Shift): Promise<void> {
  if (!deps.bot) return;
  const text = approvalTextFor(deps.db, sick);
  for (const row of listApprovalMessages(deps.db, sick.id)) {
    try {
      await deps.bot.api.editMessageText(row.chatId, row.messageId, text, { reply_markup: sickApprovalKeyboard(sick.id) });
    } catch (err) {
      console.error("sick approval: cosmetic redraw failed:", safeErrorMessage(err));
    }
  }
}

/**
 * The worker took the extension back (edited the dates inside the approved span again):
 * nothing is left to ask, so the request closes and every admin's buttons say so. The row
 * stays approved, as it was before the extension.
 */
export async function withdrawExtension(deps: SickApprovalDeps, sick: Shift): Promise<void> {
  const cleared = claimPendingSickLeave(deps.db, sick.id, null);
  if (!cleared) return;
  await finishApprovalMessages(deps, sick.id, `${approvalTextFor(deps.db, cleared)}\n\n↩️ Продление снято — ОК не нужен`);
}

/**
 * Replace the buttons with the outcome in every admin's copy. Rows are deleted
 * BEFORE editing, so a second decision racing this one finds nothing to edit twice.
 * Cosmetic: an edit failing (message deleted by hand) must not undo the decision.
 */
export async function finishApprovalMessages(deps: SickApprovalDeps, entryId: number, finalText: string): Promise<void> {
  const rows = listApprovalMessages(deps.db, entryId);
  deleteApprovalMessages(deps.db, entryId);
  await editApprovalMessages(deps, rows, finalText);
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
function refusal(db: Db, entryId: number): SickDecision {
  const entry = getShift(db, entryId);
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
  if (!claimed || !before) return refusal(db, entryId);
  const adminName = nameOf(db, adminId) ?? "Админ";
  const extension = extensionOf(before);
  recordAudit(db, "sick_leave_approved", adminId, entryAuditPayload(db, claimed));
  await tellDecided(onDecided);
  await finishApprovalMessages(deps, entryId, `${approvalTextFor(db, before)}\n\n✅ Подтвердил(а) ${adminName}`);

  const owner = claimed.employeeId == null ? undefined : getEmployeeById(db, claimed.employeeId);
  // Observers are out of hand-overs entirely — the same gate as the self-entry route.
  let hasDrafts = false;
  if (owner && !owner.isObserver) {
    // Exactly what a sick leave created today starts (owner's decision): drafts with no
    // addressee for the worker to pick a colleague, and the existing ladder's timer —
    // silence for `handoverFanHours` fans out to everyone free. Idempotent per shift:
    // whatever the urgent branch already handed over is skipped.
    // An extension asks only about its new days: the approved ones already have their hand-overs.
    const onlyDates = extension ? new Set(daysAsked(before)) : undefined;
    const made = await startHandovers(deps, { sickEntry: claimed, employeeId: owner.id, onlyDates });
    // A shift with nobody free is escalated inside `startHandovers` («fanned» at once);
    // only an «offered» one is a draft the worker can still act on.
    hasDrafts = made.some((handover) => handover.status === "offered");
  }
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

export async function rejectSickLeave(
  deps: SickApprovalDeps,
  entryId: number,
  adminId: number,
  onDecided?: OnDecided,
): Promise<SickDecision> {
  const { db } = deps;
  const before = getShift(db, entryId);
  const claimed = claimPendingSickLeave(db, entryId, null);
  if (!claimed || !before) return refusal(db, entryId);
  const adminName = nameOf(db, adminId) ?? "Админ";
  const extension = extensionOf(before);
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

  await tellDecided(onDecided);
  await editApprovalMessages(deps, messages, `${letter}\n\n❌ Отклонил(а) ${adminName}`);
  await notifyCancelledHandovers(deps, cancelled);
  if (claimed.employeeId != null) {
    await deps.messenger.plain(claimed.employeeId, sickRejectedWorkerText(claimed, adminName, extension));
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
