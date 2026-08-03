import type { ReactNode } from "react";
import { Button } from "@telegram-apps/telegram-ui";
import type { SwapRequest, SwapShiftSummary, SwapStatus } from "../api/client";
import { formatDayLabel } from "../lib/week";
import { formatTimeRange } from "../lib/shift";
import { useIsDark } from "../lib/theme";

/** "Пн, 14 июля · 09:00–18:00 · День" — the preset name matters: without it a
 * Friday «Утро» (08:00–15:45) reads like a mis-timed «День». */
function formatSwapShift(shift: SwapShiftSummary | null): string {
  if (!shift || !shift.date) return "—";
  const name = shift.title ? ` · ${shift.title}` : "";
  return `${formatDayLabel(shift.date)} · ${formatTimeRange(shift)}${name}`;
}

const STATUS_LABELS: Record<SwapStatus, string> = {
  pending: "Ждём ответа",
  accepted: "Принято",
  declined: "Отклонено",
  cancelled: "Отменено",
  expired: "Истекло",
};

interface StatusPalette {
  readonly bg: string;
  readonly fg: string;
}

const STATUS_LIGHT: Record<SwapStatus, StatusPalette> = {
  pending: { bg: "#E3EFFC", fg: "#1C6FC9" },
  accepted: { bg: "#E1F6E1", fg: "#1F7A34" },
  declined: { bg: "#FBE3E1", fg: "#C13B2E" },
  cancelled: { bg: "#EDEDF2", fg: "#6B6F80" },
  expired: { bg: "#EDEDF2", fg: "#6B6F80" },
};

const STATUS_DARK: Record<SwapStatus, StatusPalette> = {
  pending: { bg: "rgba(64,150,238,0.24)", fg: "#8EC9FF" },
  accepted: { bg: "rgba(70,190,90,0.22)", fg: "#86E093" },
  declined: { bg: "rgba(230,80,60,0.24)", fg: "#F5A296" },
  cancelled: { bg: "rgba(140,144,160,0.24)", fg: "#C6C9D4" },
  expired: { bg: "rgba(140,144,160,0.24)", fg: "#C6C9D4" },
};

export interface SwapStatusPillProps {
  status: SwapStatus;
}

/** Small colored pill for a swap request's status ("Ждём ответа" / "Принято" / …), legible in light and dark. */
export function SwapStatusPill({ status }: SwapStatusPillProps) {
  const isDark = useIsDark();
  const palette = (isDark ? STATUS_DARK : STATUS_LIGHT)[status];
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 12.5,
        fontWeight: 600,
        borderRadius: 999,
        padding: "4px 10px",
        whiteSpace: "nowrap",
        background: palette.bg,
        color: palette.fg,
      }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function SwapDirectionLine({ label, shift }: { label: string; shift: SwapShiftSummary | null }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 14.5 }}>
      <span style={{ color: "var(--tgui--hint_color)", flex: "none" }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{formatSwapShift(shift)}</span>
    </div>
  );
}

function MessageBubble({ message }: { message: string }) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: "8px 12px",
        borderRadius: 12,
        background: "var(--tgui--secondary_bg_color)",
        color: "var(--tgui--text_color)",
        fontSize: 14,
        lineHeight: 1.4,
      }}
    >
      {message}
    </div>
  );
}

function CardShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--tgui--section_bg_color, var(--tgui--bg_color))",
        borderRadius: 14,
        padding: "14px 14px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Почему нажатие на этой карточке не сработало. Ответ живёт рядом с кнопкой,
 * на которую нажали: мини-апп — один длинный скролл, и общий блок над списком
 * при нажатии на карточку ниже оказывается за верхним краем экрана.
 */
function ActionError({ message }: { message: string }) {
  return (
    <div style={{ marginTop: 8, color: "var(--tgui--destructive_text_color)", fontSize: 13.5, lineHeight: 1.35 }}>
      {message}
    </div>
  );
}

export interface IncomingSwapCardProps {
  request: SwapRequest;
  onAccept: () => void;
  onDecline: () => void;
  busy?: boolean;
  /** Отказ на последнее нажатие именно этой карточки. */
  error?: string;
}

/** A pending swap a colleague proposed to the current user: what they're offering, what they want in return. */
export function IncomingSwapCard({ request, onAccept, onDecline, busy, error }: IncomingSwapCardProps) {
  return (
    <CardShell>
      <div style={{ fontWeight: 600, fontSize: 15 }}>{request.counterpartyName}</div>
      <SwapDirectionLine label="Коллега отдаёт →" shift={request.theirShift} />
      <SwapDirectionLine label="Ты отдаёшь →" shift={request.yourShift} />
      {request.message && <MessageBubble message={request.message} />}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Button size="s" mode="filled" stretched loading={busy} disabled={busy} onClick={onAccept}>
          Принять
        </Button>
        <Button size="s" mode="gray" stretched disabled={busy} onClick={onDecline}>
          Отклонить
        </Button>
      </div>
      {error && <ActionError message={error} />}
    </CardShell>
  );
}

export interface OutgoingSwapCardProps {
  request: SwapRequest;
  onCancel: () => void;
  busy?: boolean;
  /** Отказ на последнее нажатие именно этой карточки. */
  error?: string;
}

/** A swap the current user proposed: its current status, and a cancel action while it's still pending. */
export function OutgoingSwapCard({ request, onCancel, busy, error }: OutgoingSwapCardProps) {
  return (
    <CardShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{request.counterpartyName}</div>
        <SwapStatusPill status={request.status} />
      </div>
      <SwapDirectionLine label="Ты отдаёшь →" shift={request.yourShift} />
      <SwapDirectionLine label="Взамен получишь →" shift={request.theirShift} />
      {request.message && <MessageBubble message={request.message} />}
      {request.status === "pending" && (
        <div style={{ marginTop: 10 }}>
          <Button size="s" mode="gray" stretched loading={busy} disabled={busy} onClick={onCancel}>
            Отменить
          </Button>
        </div>
      )}
      {error && <ActionError message={error} />}
    </CardShell>
  );
}

export interface ArchivedSwapCardProps {
  request: SwapRequest;
}

/**
 * A settled swap, either direction. No buttons: there is nothing left to accept,
 * decline or cancel, and the past tense in the labels says so without a chip.
 */
export function ArchivedSwapCard({ request }: ArchivedSwapCardProps) {
  const outgoing = request.direction === "outgoing";
  return (
    <CardShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{request.counterpartyName}</div>
        <SwapStatusPill status={request.status} />
      </div>
      <SwapDirectionLine
        label={outgoing ? "Ты отдавал →" : "Коллега отдавал →"}
        shift={outgoing ? request.yourShift : request.theirShift}
      />
      <SwapDirectionLine
        label={outgoing ? "Взамен просил →" : "Взамен просил твою →"}
        shift={outgoing ? request.theirShift : request.yourShift}
      />
      {request.message && <MessageBubble message={request.message} />}
    </CardShell>
  );
}
