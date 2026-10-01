import { ConfirmButton } from "../components/ConfirmButton";
import type { ReactNode } from "react";
import { Placeholder } from "@telegram-apps/telegram-ui";
import type { VacantSlot, WeekendOffer, WeekendSlotView } from "../api/client";
import { formatDayLabel } from "../lib/week";
import { pluralizeRu } from "../lib/shift";
import { ActionButton, Card, Group, Screen, StatusPill } from "../ui";

export interface WeekendScreenProps {
  slots: WeekendSlotView[];
  offers: WeekendOffer[];
  /** Ids of slots / offers currently being mutated — each card disables only its
   *  own buttons while its own request is in flight. */
  busySlotIds: ReadonlySet<number>;
  busyOfferIds: ReadonlySet<number>;
  /**
   * Why a tap on this card failed, by slot / assignment id — the answer belongs
   * in the card that was tapped. A single message above the list is off-screen
   * for every card the reader had to scroll to (замер на 390×844: вторая
   * «🙋 Хочу» на y=690 при прокрутке 267, блок ошибки при этом на y=−134).
   * Cleared on the next attempt on that same card.
   */
  slotErrors: ReadonlyMap<number, string>;
  offerErrors: ReadonlyMap<number, string>;
  onInterest: (slotId: number) => void;
  /** «Передумал» — снять свой «Хочу», пока не назначили. */
  onWithdrawInterest: (slotId: number) => void;
  onConfirm: (offerId: number) => void;
  onDecline: (offerId: number) => void;
}

/** "Работа в выходные": weekend/holiday shifts up for grabs, and offers an admin addressed to you. */
export function WeekendScreen({ slots, offers, busySlotIds, busyOfferIds, slotErrors, offerErrors, onInterest, onWithdrawInterest, onConfirm, onDecline }: WeekendScreenProps) {
  const liveOffers = offers.filter((o) => o.assignment.status !== "declined");

  return (
    <Screen title="Работа в выходные" subtitle="Нажми «Хочу» — админ распределит по-честному.">
      {liveOffers.length > 0 && (
        <Group header="Мои назначения">
          {liveOffers.map((offer) => (
            <OfferCard
              key={offer.assignment.id}
              offer={offer}
              busy={busyOfferIds.has(offer.assignment.id)}
              error={offerErrors.get(offer.assignment.id)}
              onConfirm={() => onConfirm(offer.assignment.id)}
              onDecline={() => onDecline(offer.assignment.id)}
            />
          ))}
        </Group>
      )}
      <Group header="Открытые смены">
        {slots.length === 0 ? (
          <Placeholder description="Сейчас нет открытых смен. Заглядывай позже 🙌" />
        ) : (
          slots.map((view) => (
            <SlotCard
              key={view.slot.id}
              view={view}
              busy={busySlotIds.has(view.slot.id)}
              error={slotErrors.get(view.slot.id)}
              onInterest={() => onInterest(view.slot.id)}
              onWithdraw={() => onWithdrawInterest(view.slot.id)}
            />
          ))
        )}
      </Group>
    </Screen>
  );
}

/** "Сб, 19 июля · 10:00–18:00" */
function slotWhen(slot: VacantSlot): string {
  return `${formatDayLabel(slot.date)} · ${slot.start}–${slot.end}`;
}

function hoursLabel(hours: number): string {
  const rounded = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  return `${rounded} ${pluralizeRu(Math.round(hours), "час", "часа", "часов")}`;
}

function SlotCard({ view, busy, error, onInterest, onWithdraw }: { view: WeekendSlotView; busy: boolean; error?: string; onInterest: () => void; onWithdraw: () => void }) {
  const { slot, interested, assignees } = view;
  return (
    <Card>
      <div style={{ fontWeight: 600, fontSize: "var(--app-text-head)", overflowWrap: "anywhere" }}>
        {slot.title ?? "Работа в выходной"}
      </div>
      <div style={{ fontSize: "var(--app-text-body)", fontWeight: 500 }}>{slotWhen(slot)}</div>
      {slot.location && <MetaLine icon="📍">{slot.location}</MetaLine>}
      {slot.note && <MetaLine icon="💬">{slot.note}</MetaLine>}
      {/* Everyone can see who's going, not just admins. */}
      {assignees.length > 0 && <MetaLine icon="👥">Выходят: {assignees.map((a) => a.name).join(", ")}</MetaLine>}
      <div style={{ marginTop: 10 }}>
        {interested ? (
          // Подтверждения не нужно: «Хочу» можно нажать снова.
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <StatusPill tone="ok">✓ Ты в списке — ждём решения админа</StatusPill>
            <ActionButton compact kind="quiet" loading={busy} onClick={onWithdraw}>Передумал(а)</ActionButton>
          </div>
        ) : (
          <ActionButton kind="primary" stretched loading={busy} onClick={onInterest}>🙋 Хочу</ActionButton>
        )}
      </div>
      {error && <ActionError message={error} />}
    </Card>
  );
}

/**
 * Почему нажатие на этой карточке не сработало. Ответ живёт рядом с кнопкой, на
 * которую нажали: мини-апп — один длинный скролл, и общий блок над списком при
 * нажатии на карточку ниже оказывается за верхним краем экрана.
 */
function ActionError({ message }: { message: string }) {
  return (
    <div style={{ marginTop: 8, color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)", lineHeight: 1.35 }}>
      {message}
    </div>
  );
}

function OfferCard({ offer, busy, error, onConfirm, onDecline }: { offer: WeekendOffer; busy: boolean; error?: string; onConfirm: () => void; onDecline: () => void }) {
  const { slot, assignment } = offer;
  const confirmed = assignment.status === "confirmed";
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: "var(--app-text-head)" }}>{slot.title ?? "Работа в выходной"}</div>
        <StatusPill tone={confirmed ? "ok" : "need"}>{confirmed ? "Подтверждено" : "Нужен ответ"}</StatusPill>
      </div>
      <div style={{ fontSize: "var(--app-text-body)", fontWeight: 500 }}>
        {slotWhen(slot)} · {hoursLabel(assignment.hours)}
      </div>
      {slot.location && <MetaLine icon="📍">{slot.location}</MetaLine>}
      {confirmed ? (
        <div style={{ marginTop: 8, fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>
          Смена уже в твоём расписании. Спасибо, что выручаешь! 🙌
        </div>
      ) : (
        // `wrap`: раскрытое подтверждение «Не смогу» — вопрос и две кнопки — не
        // помещается рядом с «Беру» и уходит строкой ниже, а не режется.
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 10 }}>
          <span style={{ flex: "1 1 140px", display: "flex" }}>
            <ActionButton kind="primary" stretched loading={busy} onClick={onConfirm}>Беру</ActionButton>
          </span>
          <ConfirmButton
            label="Не смогу"
            compact={false}
            question="Отказаться от этой смены? Передумать потом не получится — админ позовёт другого."
            confirmLabel="Да, не смогу"
            disabled={busy}
            onConfirm={onDecline}
          />
        </div>
      )}
      {error && <ActionError message={error} />}
    </Card>
  );
}

function MetaLine({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 6, fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)", lineHeight: 1.35 }}>
      <span style={{ flex: "none" }}>{icon}</span>
      <span>{children}</span>
    </div>
  );
}
