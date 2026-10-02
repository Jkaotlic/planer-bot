import { isSwappable } from "@planer/shared";
import type { Shift, Template } from "../api/client";
import { formatTimeRange } from "../lib/shift";
import { DayBadge } from "./DayBadge";
import { EntryChip } from "./EntryChip";

export interface ShiftRowProps {
  shift: Shift;
  /** Presets, to colour the entry by the one it came from. */
  templates: readonly Template[];
  /** Opens the "Предложить обмен" flow for this shift. Omit to render the row read-only (no "Обменять" pill). */
  onSwap?: (shift: Shift) => void;
  /** Today's row is marked: an accent rail on the left and a «Сегодня» chip. */
  isToday?: boolean;
  /** Почему обмен сейчас недоступен. Кнопка остаётся на месте, но гаснет и несёт
   *  эту фразу: пропавшая кнопка читается как поломка, погашенная — как правило. */
  swapBlockedReason?: string;
  /** Тап по строке (не по «Обменять» — та сама гасит клик `stopPropagation`) —
   *  раскрывает под ней «Кто ещё работает». Опущен — строка не реагирует на тап. */
  onOpen?: (shift: Shift) => void;
  /** Раскрыт ли лист под строкой. Читается только у раскрываемой строки: скринридеру
   *  надо знать состояние кнопки, а не угадывать его по появившемуся тексту. */
  expanded?: boolean;
  /** Подпись особого дня («🎉 День России» / «💼 рабочая») — смена выпала на
   *  праздник или рабочую субботу. Текстом, а не `title`: на телефоне подсказки нет. */
  special?: string;
}

/** A single row in "Мои смены": day, time (or "Весь день"), and a chip naming the
 * entry in its preset's colour. */
export function ShiftRow({ shift, templates, onSwap, isToday, swapBlockedReason, onOpen, expanded, special }: ShiftRowProps) {
  // По той же причине, что в `swap-candidates.ts`: одно правило, один источник.
  // Локальной копии «category === shift» здесь больше нет — с 2026-08-10 ответ
  // на этот вопрос знает только shared.
  const swappable = isSwappable(shift.category);

  const openable = onOpen != null;
  return (
    // Своя строка, а не `Cell`: тот несёт «андроидные» поля (24px) и рипл на
    // весь блок, который перехватывал нажатия по «Обменять» (см. `SwapChip`).
    <div
      data-testid="shift-row"
      className="shift-row"
      role={openable ? "button" : undefined}
      tabIndex={openable ? 0 : undefined}
      aria-expanded={openable ? (expanded ?? false) : undefined}
      onClick={openable ? () => onOpen(shift) : undefined}
      onKeyDown={
        openable
          ? (e) => {
              // Только своё нажатие: Enter/пробел на вложенной «Обменять» всплывает
              // сюда же и раскрыл бы строку заодно с обменом.
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(shift);
              }
            }
          : undefined
      }
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        minHeight: 64,
        cursor: openable ? "pointer" : undefined,
        ...(isToday
          ? {
              // Рельс, а не залитая строка: чип внутри уже несёт цвет пресета,
              // и два фона спорят.
              boxShadow: "inset 3px 0 var(--tgui--link_color)",
              background: "color-mix(in srgb, var(--tgui--link_color) 7%, transparent)",
            }
          : null),
      }}
    >
      <DayBadge date={shift.date} endDate={shift.endDate} />
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
        <span style={{ fontSize: "var(--app-text-body)", fontWeight: 500 }}>{formatTimeRange(shift)}</span>
        {/* Чип называет запись («Утро» / «Отпуск») цветом своего пресета. */}
        <EntryChip entry={shift} templates={templates} />
        {/* Обычный цвет, а не hint: серый давал 4.23 (тёмная) и 3.22 (светлая) при нужных 4.5. */}
        {special && (
          <span data-special-day style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--text_color)", lineHeight: 1.3 }}>
            {special}
          </span>
        )}
      </div>
      {(isToday || (swappable && onSwap)) && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          {isToday && <TodayChip />}
          {swappable && onSwap && <SwapChip onClick={() => onSwap(shift)} blockedReason={swapBlockedReason} />}
        </div>
      )}
    </div>
  );
}

/** The text half of the "today" signal — colour is never the only carrier. */
function TodayChip() {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.2,
        borderRadius: 999,
        padding: "2px 8px",
        color: "var(--tgui--button_text_color)",
        background: "var(--tgui--link_color)",
        whiteSpace: "nowrap",
      }}
    >
      Сегодня
    </span>
  );
}

interface SwapChipProps {
  onClick: () => void;
  /** Причина, по которой обмен сейчас недоступен. Заданная — кнопка гаснет,
   *  показывает эту фразу под собой и не зовёт `onClick`. */
  blockedReason?: string;
}

/** The "Обменять" affordance: opens the propose-swap flow for this shift, or —
 *  with `blockedReason` set — stays on the row dimmed and names why, instead of
 *  disappearing (a missing button reads as "the app is broken"). A real
 *  `<button>`, not a `role="button"` span: its native `disabled` state is what
 *  makes "не срабатывает" free — no extra guard can silently drift out of sync
 *  with the dimmed styling next to it. */
function SwapChip({ onClick, blockedReason }: SwapChipProps) {
  const blocked = blockedReason != null;
  const button = (
    <button
      type="button"
      disabled={blocked}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="ui-btn ui-btn--secondary ui-btn--compact"
      style={blocked ? { color: "var(--tgui--hint_color)" } : undefined}
    >
      Обменять
    </button>
  );
  // No wrapper when there's nothing to caption: keeps the button the row's
  // only "Обменять"-labelled element, so anything hunting for it by its exact
  // text (as well as by tag) lands on the real control, not an ancestor `<div>`
  // that happens to repeat the same text.
  if (!blocked) return button;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
      {button}
      <span
        style={{
          fontSize: 11,
          color: "var(--tgui--hint_color)",
          textAlign: "right",
          maxWidth: 130,
          lineHeight: 1.3,
        }}
      >
        {blockedReason}
      </span>
    </div>
  );
}
