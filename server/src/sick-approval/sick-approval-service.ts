import type { Bot } from "grammy";
import { eachDayIso, isAbsence, type SickApprovalRow } from "@planer/shared";
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
} from "../repo/sick-approvals";
import { sendTracked } from "../bot/tracked-send";
import { dayAfterLine } from "../schedule/day-summary";
import { safeErrorMessage } from "../util/safe-error";
import { entryAuditPayload, entryLineOf, nameOf } from "../util/message-lines";
import {
  cancelHandoversForEntry,
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

/** Per-day «На Вт 6 окт стоят: …» — the same lines the old self-entry notice carried. */
function dayLines(db: Db, sick: Shift): string[] {
  if (sick.employeeId == null) return [];
  return eachDayIso(sick.date, sick.endDate ?? sick.date)
    .map((date) => dayAfterLine(db, { employeeId: sick.employeeId!, date, keepSilentForEntryId: sick.id, voice: "admins" }))
    .filter((line): line is string => line !== null);
}

export function approvalTextFor(db: Db, sick: Shift): string {
  const owner = sick.employeeId == null ? undefined : getEmployeeById(db, sick.employeeId);
  return sickApprovalText(owner?.displayName ?? "Работник", sick, dayLines(db, sick), owner?.isObserver ?? false);
}

/**
 * Ask the admins. Our own loop over `listAdmins` + `sendTracked` rather than
 * `notifyAdminsAlways`: that one cannot report message ids, and without them the
 * buttons could not be taken away from the others once one admin decides. Like
 * `notifyAdminsAlways` it ignores notice mutes — the hand-over hangs on this letter.
 */
export async function requestApproval(deps: SickApprovalDeps, sick: Shift): Promise<Shift> {
  const marked = markApprovalRequested(deps.db, sick.id, new Date((deps.now ?? Date.now)())) ?? sick;
  if (!deps.bot) return marked;
  const text = approvalTextFor(deps.db, marked);
  for (const admin of listAdmins(deps.db)) {
    if (admin.telegramUserId == null || admin.id === marked.employeeId) continue;
    const messageId = await sendTracked(deps.bot, admin.telegramUserId, text, sickApprovalKeyboard(marked.id));
    if (messageId != null) addApprovalMessage(deps.db, marked.id, admin.telegramUserId, messageId);
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
 * Replace the buttons with the outcome in every admin's copy. Rows are deleted
 * BEFORE editing, so a second decision racing this one finds nothing to edit twice.
 * Cosmetic: an edit failing (message deleted by hand) must not undo the decision.
 */
export async function finishApprovalMessages(deps: SickApprovalDeps, entryId: number, finalText: string): Promise<void> {
  const rows = listApprovalMessages(deps.db, entryId);
  deleteApprovalMessages(deps.db, entryId);
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
  const claimed = claimPendingSickLeave(db, entryId, adminId);
  if (!claimed) return refusal(db, entryId);
  const adminName = nameOf(db, adminId) ?? "Админ";
  recordAudit(db, "sick_leave_approved", adminId, entryAuditPayload(db, claimed));
  await tellDecided(onDecided);
  await finishApprovalMessages(deps, entryId, `${approvalTextFor(db, claimed)}\n\n✅ Подтвердил(а) ${adminName}`);

  const owner = claimed.employeeId == null ? undefined : getEmployeeById(db, claimed.employeeId);
  // Observers are out of hand-overs entirely — the same gate as the self-entry route.
  let hasDrafts = false;
  if (owner && !owner.isObserver) {
    // Exactly what a sick leave created today starts (owner's decision): drafts with no
    // addressee for the worker to pick a colleague, and the existing ladder's timer —
    // silence for `handoverFanHours` fans out to everyone free. Idempotent per shift:
    // whatever the urgent branch already handed over is skipped.
    const made = await startHandovers(deps, { sickEntry: claimed, employeeId: owner.id });
    // A shift with nobody free is escalated inside `startHandovers` («fanned» at once);
    // only an «offered» one is a draft the worker can still act on.
    hasDrafts = made.some((handover) => handover.status === "offered");
  }
  if (owner?.telegramUserId != null && deps.bot) {
    await notifyUser(
      deps.bot,
      owner.telegramUserId,
      sickApprovedWorkerText(claimed, adminName, hasDrafts),
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
  const claimed = claimPendingSickLeave(db, entryId, null);
  if (!claimed) return refusal(db, entryId);
  const adminName = nameOf(db, adminId) ?? "Админ";
  // Read before anything goes: the journal and the letters must name what was rejected.
  const payload = entryAuditPayload(db, claimed);
  const letter = approvalTextFor(db, claimed);
  await tellDecided(onDecided);
  // Whatever the urgent branch started dies the way a worker's own delete kills it.
  // Taken hand-overs stay: that shift already has a new owner (`cancelHandoversForEntry`).
  await cancelHandoversForEntry(deps, entryId, []);
  detachHandoversFromEntry(db, entryId);
  // Before the delete: the CASCADE takes the message ids with the row.
  await finishApprovalMessages(deps, entryId, `${letter}\n\n❌ Отклонил(а) ${adminName}`);
  deleteShift(db, entryId);
  recordAudit(db, "sick_leave_rejected", adminId, payload);
  if (claimed.employeeId != null) {
    await deps.messenger.plain(claimed.employeeId, sickRejectedWorkerText(claimed, adminName));
  }
  return { ok: true, adminName };
}

/** Work the sick leave takes away, one line per shift — the list screens show it under the name. */
function sickShiftLines(db: Db, sick: Shift): string[] {
  if (sick.employeeId == null) return [];
  return listEmployeeShiftsOverlapping(db, sick.employeeId, sick.date, sick.endDate ?? sick.date)
    .filter((entry) => entry.id !== sick.id && !isAbsence(entry.category) && entry.category !== "offsite")
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
    }));
}
