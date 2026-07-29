import { useState } from "react";
import { Avatar, Button, Cell, IconButton, List, Placeholder, Section, Selectable, Textarea, Title } from "@telegram-apps/telegram-ui";
import type { Shift } from "../api/client";
import { DayBadge } from "../components/DayBadge";
import { ScreenScroll } from "../components/ScreenScroll";
import { categoryLabel } from "../categories";
import { initialsOf, personPalette } from "../lib/people";
import { formatTimeRange } from "../lib/shift";

export interface ProposeSwapScreenProps {
  /** The caller's own shift being offered up — opened from its "Обменять" affordance. */
  fromShift: Shift;
  /** Colleagues' upcoming swappable shifts to choose from (already excludes the caller's own). */
  colleagueShifts: Shift[];
  onCancel: () => void;
  onConfirm: (toShiftId: number, message: string) => Promise<void>;
}

/** "Предложить обмен": pick a colleague's shift to swap for the one you're giving up, add an optional note, confirm. */
export function ProposeSwapScreen({ fromShift, colleagueShifts, onCancel, onConfirm }: ProposeSwapScreenProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selected = colleagueShifts.find((s) => s.id === selectedId) ?? null;
  // `employeeName` is the roster's «Фамилия Имя», not an address — we only have the
  // full display name here (no `address` on a team-schedule row), so show it whole
  // rather than guess at a first name. See `addressOf` in @planer/shared.
  const confirmLabel = selected
    ? `Предложить обмен ${selected.employeeName ?? "коллеге"}`
    : "Выберите смену коллеги";

  async function handleConfirm() {
    if (!selected || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(selected.id, message.trim());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScreenScroll>
      <header style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 4px 16px" }}>
        <IconButton mode="plain" size="m" aria-label="Назад" onClick={onCancel}>
          <BackIcon />
        </IconButton>
        <Title level="2" weight="2">
          Предложить обмен
        </Title>
      </header>

      <List>
        <Section header="Отдаёшь свою смену">
          <Cell
            before={<DayBadge date={fromShift.date} endDate={fromShift.endDate} />}
            subtitle={fromShift.title ?? categoryLabel(fromShift.category)}
          >
            {formatTimeRange(fromShift)}
          </Cell>
        </Section>
      </List>

      <SwapDivider />

      <List>
        <Section header="Взамен берёшь смену коллеги">
          {colleagueShifts.length === 0 ? (
            <Placeholder description="На этой неделе нет доступных смен коллег для обмена." />
          ) : (
            colleagueShifts.map((shift) => {
              const name = shift.employeeName ?? "Без имени";
              const palette = personPalette(shift.employeeId);
              return (
                <Cell
                  key={shift.id}
                  before={<Avatar acronym={initialsOf(name)} size={40} style={{ background: palette.bg, color: palette.fg }} />}
                  subtitle={`${formatTimeRange(shift)} · ${shift.title ?? categoryLabel(shift.category)}`}
                  after={
                    <Selectable
                      type="radio"
                      name="colleague-shift"
                      checked={selectedId === shift.id}
                      onChange={() => setSelectedId(shift.id)}
                    />
                  }
                  onClick={() => setSelectedId(shift.id)}
                >
                  {name}
                </Cell>
              );
            })
          )}
        </Section>
      </List>

      <List>
        <Section header="Сообщение (необязательно)">
          <div style={{ padding: "2px 12px 14px" }}>
            <Textarea
              placeholder="Например: смогу поработать в другой день"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
            />
          </div>
        </Section>
      </List>

      <div style={{ padding: "6px 4px 4px" }}>
        <Button size="l" stretched mode="filled" disabled={!selected || submitting} loading={submitting} onClick={handleConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </ScreenScroll>
  );
}

/** A centered "⇄" divider between the "give" and "take" halves of the propose flow. */
function SwapDivider() {
  return (
    <div style={{ display: "flex", justifyContent: "center", margin: "2px 0 14px" }}>
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--tgui--secondary_bg_color)",
          color: "var(--tgui--hint_color)",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <path d="M7 7h11l-3.5-3.5M17 17H6l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
