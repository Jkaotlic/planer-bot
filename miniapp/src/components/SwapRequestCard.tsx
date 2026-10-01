import type { SwapRequest, SwapShiftSummary, SwapStatus } from "../api/client";
import { categoryLabel } from "../categories";
import { formatDayLabel } from "../lib/week";
import { formatTimeRange } from "../lib/shift";
import { ActionButton, Card, StatusPill } from "../ui";

/** "Пн, 14 июля · 09:00–18:00 · День" — the preset name matters: without it a
 * Friday «Утро» (08:00–15:45) reads like a mis-timed «День».
 *
 * Своей подписи у записи может не быть, и тогда называем категорию: с
 * 2026-08-10 в обмене бывает дежурство, а именно по этой карточке человек
 * решает, что берёт. Безымянная строка молчала бы ровно там, где решение и
 * принимается. */
function formatSwapShift(shift: SwapShiftSummary | null): string {
  if (!shift || !shift.date) return "—";
  const name = shift.title ?? categoryLabel(shift.category);
  return `${formatDayLabel(shift.date)} · ${formatTimeRange(shift)} · ${name}`;
}

const STATUS_LABELS: Record<SwapStatus, string> = {
  pending: "Ждём ответа",
  accepted: "Принято",
  declined: "Отклонено",
  cancelled: "Отменено",
  expired: "Истекло",
};

export interface SwapStatusPillProps {
  status: SwapStatus;
}

/** Пилюля статуса заявки. Тонов четыре, а статусов пять: состоявшийся обмен — «улажено», отклонённый — красный (до перехода на общий набор был красным, и терять это нельзя: отказ должен бросаться в глаза), ждущий — «ждём»; отменённые и истёкшие отличает подпись, а не цвет. */
export function SwapStatusPill({ status }: SwapStatusPillProps) {
  const tone = status === "accepted" ? "ok" : status === "declined" ? "bad" : "wait";
  return <StatusPill tone={tone}>{STATUS_LABELS[status]}</StatusPill>;
}

function SwapDirectionLine({ label, shift }: { label: string; shift: SwapShiftSummary | null }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: "var(--app-text-body)", flexWrap: "wrap" }}>
      <span style={{ color: "var(--tgui--hint_color)", flex: "none" }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{formatSwapShift(shift)}</span>
      {shift?.category === "duty" && <DutyPill />}
    </div>
  );
}

/** Дежурство — не «смена в другое время»: человек садится на телефон или едет на
 *  точку. Отдельной пилюлей, а не только названием в строке: название легко
 *  проскользить взглядом, когда рядом кнопка «Принять». Словом, не цветом —
 *  то же правило, что на «Сегодня» в `ShiftRow`. */
function DutyPill() {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.2,
        borderRadius: 999,
        padding: "2px 8px",
        whiteSpace: "nowrap",
        color: "var(--tgui--button_text_color)",
        background: "var(--tgui--link_color)",
      }}
    >
      Дежурство
    </span>
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
        fontSize: "var(--app-text-body)",
        lineHeight: 1.4,
      }}
    >
      {message}
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
    <div style={{ marginTop: 8, color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)", lineHeight: 1.35 }}>
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
    <Card>
      <div style={{ fontWeight: 600, fontSize: "var(--app-text-head)" }}>{request.counterpartyName}</div>
      <SwapDirectionLine label="Коллега отдаёт →" shift={request.theirShift} />
      <SwapDirectionLine label="Ты отдаёшь →" shift={request.yourShift} />
      {request.message && <MessageBubble message={request.message} />}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <span style={{ flex: "1 1 0", display: "flex" }}>
          <ActionButton kind="primary" stretched loading={busy} onClick={onAccept}>Принять</ActionButton>
        </span>
        <span style={{ flex: "1 1 0", display: "flex" }}>
          <ActionButton stretched disabled={busy} onClick={onDecline}>Отклонить</ActionButton>
        </span>
      </div>
      {error && <ActionError message={error} />}
    </Card>
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
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: "var(--app-text-head)" }}>{request.counterpartyName}</div>
        <SwapStatusPill status={request.status} />
      </div>
      <SwapDirectionLine label="Ты отдаёшь →" shift={request.yourShift} />
      <SwapDirectionLine label="Взамен получишь →" shift={request.theirShift} />
      {request.message && <MessageBubble message={request.message} />}
      {request.status === "pending" && (
        <div style={{ marginTop: 10 }}>
          <ActionButton stretched loading={busy} onClick={onCancel}>Отменить</ActionButton>
        </div>
      )}
      {error && <ActionError message={error} />}
    </Card>
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
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: "var(--app-text-head)" }}>{request.counterpartyName}</div>
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
    </Card>
  );
}
