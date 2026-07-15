import type { ReactNode } from "react";
import { Button, List, Placeholder, Section, Title } from "@telegram-apps/telegram-ui";
import type { VacantSlot, WeekendOffer, WeekendSlotView } from "../api/client";
import { CategoryChip } from "../categories";
import { ScreenScroll } from "../components/ScreenScroll";
import { formatDayLabel } from "../lib/week";
import { pluralizeRu } from "../lib/shift";
import { useIsDark } from "../lib/theme";

export interface WeekendScreenProps {
  slots: WeekendSlotView[];
  offers: WeekendOffer[];
  /** The slot / offer currently being mutated, if any — disables just its own buttons while in flight. */
  busySlotId: number | null;
  busyOfferId: number | null;
  onInterest: (slotId: number) => void;
  onConfirm: (offerId: number) => void;
  onDecline: (offerId: number) => void;
}

/** "Работа в выходные дни": weekend/holiday shifts up for grabs, and offers an admin addressed to you. */
export function WeekendScreen({ slots, offers, busySlotId, busyOfferId, onInterest, onConfirm, onDecline }: WeekendScreenProps) {
  const liveOffers = offers.filter((o) => o.assignment.status !== "declined");

  return (
    <ScreenScroll>
      <header style={{ margin: "8px 4px 4px" }}>
        <Title level="2" weight="2">
          Работа в выходные дни
        </Title>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--tgui--hint_color)", lineHeight: 1.4 }}>
          Свободные смены в выходные и праздники. Нажми «Хочу» — админ распределит по-честному.
        </p>
      </header>

      <List>
        {liveOffers.length > 0 && (
          <Section header="Мои назначения">
            <CardStack>
              {liveOffers.map((offer) => (
                <OfferCard
                  key={offer.assignment.id}
                  offer={offer}
                  busy={busyOfferId === offer.assignment.id}
                  onConfirm={() => onConfirm(offer.assignment.id)}
                  onDecline={() => onDecline(offer.assignment.id)}
                />
              ))}
            </CardStack>
          </Section>
        )}

        <Section header="Открытые смены">
          {slots.length === 0 ? (
            <Placeholder description="Сейчас нет открытых смен. Заглядывай позже 🙌" />
          ) : (
            <CardStack>
              {slots.map((view) => (
                <SlotCard
                  key={view.slot.id}
                  view={view}
                  busy={busySlotId === view.slot.id}
                  onInterest={() => onInterest(view.slot.id)}
                />
              ))}
            </CardStack>
          )}
        </Section>
      </List>
    </ScreenScroll>
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

function SlotCard({ view, busy, onInterest }: { view: WeekendSlotView; busy: boolean; onInterest: () => void }) {
  const { slot, interested } = view;
  return (
    <CardShell>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 15.5 }}>{slot.title ?? "Работа в выходной"}</div>
        <CategoryChip category="weekend_work">Выходной</CategoryChip>
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 500 }}>{slotWhen(slot)}</div>
      {slot.location && <MetaLine icon="📍">{slot.location}</MetaLine>}
      {slot.note && <MetaLine icon="💬">{slot.note}</MetaLine>}
      <div style={{ marginTop: 10 }}>
        {interested ? (
          <InListPill />
        ) : (
          <Button size="s" mode="filled" stretched loading={busy} disabled={busy} onClick={onInterest}>
            🙋 Хочу
          </Button>
        )}
      </div>
    </CardShell>
  );
}

function OfferCard({ offer, busy, onConfirm, onDecline }: { offer: WeekendOffer; busy: boolean; onConfirm: () => void; onDecline: () => void }) {
  const { slot, assignment } = offer;
  const confirmed = assignment.status === "confirmed";
  return (
    <CardShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 15.5 }}>{slot.title ?? "Работа в выходной"}</div>
        <OfferStatusPill confirmed={confirmed} />
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 500 }}>
        {slotWhen(slot)} · {hoursLabel(assignment.hours)}
      </div>
      {slot.location && <MetaLine icon="📍">{slot.location}</MetaLine>}
      {confirmed ? (
        <div style={{ marginTop: 8, fontSize: 13.5, color: "var(--tgui--hint_color)" }}>
          Смена уже в твоём расписании. Спасибо, что выручаешь! 🙌
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <Button size="s" mode="filled" stretched loading={busy} disabled={busy} onClick={onConfirm}>
            Беру
          </Button>
          <Button size="s" mode="gray" stretched disabled={busy} onClick={onDecline}>
            Не смогу
          </Button>
        </div>
      )}
    </CardShell>
  );
}

function MetaLine({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 6, fontSize: 13.5, color: "var(--tgui--hint_color)", lineHeight: 1.35 }}>
      <span style={{ flex: "none" }}>{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function InListPill() {
  const isDark = useIsDark();
  const palette = isDark ? { bg: "rgba(70,190,90,0.22)", fg: "#86E093" } : { bg: "#E1F6E1", fg: "#1F7A34" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5, fontWeight: 600, borderRadius: 999, padding: "6px 12px", background: palette.bg, color: palette.fg }}>
      ✓ Ты в списке — ждём решения админа
    </span>
  );
}

function OfferStatusPill({ confirmed }: { confirmed: boolean }) {
  const isDark = useIsDark();
  const palette = confirmed
    ? isDark
      ? { bg: "rgba(70,190,90,0.22)", fg: "#86E093" }
      : { bg: "#E1F6E1", fg: "#1F7A34" }
    : isDark
      ? { bg: "rgba(64,150,238,0.24)", fg: "#8EC9FF" }
      : { bg: "#E3EFFC", fg: "#1C6FC9" };
  return (
    <span style={{ display: "inline-block", fontSize: 12.5, fontWeight: 600, borderRadius: 999, padding: "4px 10px", whiteSpace: "nowrap", background: palette.bg, color: palette.fg }}>
      {confirmed ? "Подтверждено" : "Нужен ответ"}
    </span>
  );
}

/** Vertically stacked cards with breathing room — mirrors SwapsScreen's CardStack. */
function CardStack({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 12px" }}>{children}</div>;
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
