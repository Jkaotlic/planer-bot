import { useState } from "react";
import { Avatar, Button, Cell, IconButton, Input, List, Placeholder, Section, Selectable, Spinner, Textarea, Title } from "@telegram-apps/telegram-ui";
import type { Shift } from "../api/client";
import { DayBadge } from "../components/DayBadge";
import { ScreenScroll } from "../components/ScreenScroll";
import { categoryLabel } from "../categories";
import { initialsOf, personPalette } from "../lib/people";
import { formatTimeRange, pluralizeRu } from "../lib/shift";

export interface ProposeSwapScreenProps {
  /** The caller's own shift being offered up — opened from its "Обменять" affordance. */
  fromShift: Shift;
  /** Colleagues working the SAME day, already filtered to those a swap can succeed with. */
  candidates: Shift[];
  /** How many people work exactly this shift that day — hidden from the list, but named. */
  sameKindCount: number;
  loading: boolean;
  loadError: string | null;
  onCancel: () => void;
  onConfirm: (toShiftId: number, message: string) => Promise<void>;
}

/** Server rejection codes for `POST /api/swaps` (see `createSwap` in swap-service.ts),
 *  turned into something a person can read. Anything not listed here (including a
 *  network/auth failure, whose message is a raw HTTP status string) falls back to
 *  the generic message below rather than leaking a code onto the screen. */
export const SWAP_ERROR_MESSAGES: Record<string, string> = {
  "identical-shift": "Это та же самая смена — обмен ничего не изменит.",
  duplicate: "Ты уже предложил обмен на эту смену — дождись ответа.",
  // Not the same as `duplicate`: the request exists, but it's theirs, so the
  // person is one tap from finishing this instead of proposing it again.
  mirror: "Коллега уже предложил тебе ровно этот обмен — ответь на его заявку в «Обменах».",
  not_your_shift: "Эта смена больше не твоя — обнови страницу.",
  // `createSwap` сегодня никогда их не возвращает: владение отдающей сменой уже
  // проверено выше (`not_your_shift`), а принимающая сторона берётся из самой
  // toShift, так что расхождение структурно невозможно. Но сторож-тест ниже
  // требует подписи на каждую причину без разбора — таблица не должна тайно
  // полагаться на «сегодня недостижимо».
  "from-shift-not-owned": "Эта смена больше не твоя — обнови страницу.",
  "to-shift-not-owned": "Смена коллеги уже досталась другому — обнови страницу.",
  target_unassigned: "На эту смену сейчас никто не назначен.",
  same_person: "Нельзя предложить обмен самому себе.",
  not_swappable: "Такими сменами нельзя меняться.",
  shift_not_found: "Смена не найдена — возможно, её уже изменили.",
  // The picker filters these out, so seeing one means the page has been open a
  // while and the shift started in the meantime.
  "from-shift-in-past": "Твоя смена уже началась — меняться поздно.",
  "to-shift-in-past": "Та смена уже началась — меняться поздно.",
  // Checked when proposing now, not only when accepting — so these are addressed
  // to the initiator, who is the one reading this screen.
  "double-booking-from": "У тебя в это время уже стоит другая смена.",
  "double-booking-to": "У коллеги в это время уже стоит другая смена.",
  // Экран предлагает только смены того же дня, так что это видно, лишь если
  // страница провисела открытой и день под ней успел смениться.
  "different-day": "Меняться можно только сменами в один и тот же день.",
  // Три запрета, которые ставит админ. Список кандидатов их уже учитывает, так
  // что сюда попадают те, у кого экран провисел открытым дольше, чем действовало
  // разрешение.
  "swaps-locked": "Обмены сейчас закрыты — админ их приостановил.",
  "from-excluded": "Тебе закрыли обмены смен. Если это ошибка — напиши админу.",
  "to-excluded": "Этому коллеге закрыли обмены смен.",
};

function describeSwapError(err: unknown): string {
  const code = err instanceof Error ? err.message : "";
  return SWAP_ERROR_MESSAGES[code] ?? "Не получилось предложить обмен. Попробуй ещё раз.";
}

/** "Предложить обмен": найти человека, который работает в тот же день, добавить
 *  записку и подтвердить. День задан отдаваемой сменой — меняться можно только
 *  внутри одного дня, поэтому выбирают здесь человека, а не смену. */
export function ProposeSwapScreen({
  fromShift,
  candidates,
  sameKindCount,
  loading,
  loadError,
  onCancel,
  onConfirm,
}: ProposeSwapScreenProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? candidates.filter((s) => (s.employeeName ?? "").toLowerCase().includes(needle))
    : candidates;
  const selected = candidates.find((s) => s.id === selectedId) ?? null;
  // `employeeName` is the roster's «Фамилия Имя», not an address — we only have the
  // full display name here (no `address` on a team-schedule row), so show it whole
  // rather than guess at a first name. See `addressOf` in @planer/shared.
  const confirmLabel = selected
    ? `Предложить обмен ${selected.employeeName ?? "коллеге"}`
    : "Выберите смену коллеги";

  async function handleConfirm() {
    if (!selected || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(selected.id, message.trim());
    } catch (err) {
      setError(describeSwapError(err));
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
        <Section header="Кто ещё работает в этот день">
          {candidates.length > 3 && (
            <div style={{ padding: "2px 12px 8px" }}>
              <Input
                type="search"
                placeholder="Поиск по имени"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
              <Spinner size="m" />
            </div>
          ) : loadError ? (
            <Placeholder description={loadError} />
          ) : candidates.length === 0 ? (
            <Placeholder description={emptyText(sameKindCount)} />
          ) : shown.length === 0 ? (
            <Placeholder description="Никого с таким именем в этот день нет." />
          ) : (
            shown.map((shift) => {
              const name = shift.employeeName ?? "Без имени";
              const palette = personPalette(shift.employeeId);
              const selectedHere = selectedId === shift.id;
              return (
                // Выбор пишется на самой строке: мини-апп — один длинный скролл,
                // и кнопка внизу для того, кто листает список, не видна.
                <Cell
                  key={shift.id}
                  data-testid="swap-candidate"
                  before={<Avatar acronym={initialsOf(name)} size={40} style={{ background: palette.bg, color: palette.fg }} />}
                  subtitle={`${formatTimeRange(shift)} · ${shift.title ?? categoryLabel(shift.category)}`}
                  // Отдельной строкой, а не приклеено к subtitle: subtitle обрезается
                  // многоточием («Cell» режет его как единую строку), и «· Выбрано»
                  // на узком экране становилось «· Выбр…» — тот же класс дефекта,
                  // что уже не раз чинили в этом мини-аппе. Чекмарк справа тоже
                  // сигнализирует выбор, но раз пишем словами — пусть будет видно целиком.
                  description={selectedHere ? "Выбрано" : undefined}
                  after={
                    <Selectable
                      type="radio"
                      name="colleague-shift"
                      checked={selectedHere}
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
          {!loading && !loadError && sameKindCount > 0 && candidates.length > 0 && (
            <div style={{ padding: "6px 16px 12px", color: "var(--tgui--hint_color)", fontSize: 13 }}>
              Ещё {sameKindCount} {pluralizeRu(sameKindCount, "человек", "человека", "человек")} в этот день на такой
              же смене — с ними обмен ничего не изменит.
            </div>
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
        {error && (
          <div style={{ padding: "0 8px 8px", color: "var(--tgui--destructive_text_color)", fontSize: 13 }}>
            {error}
          </div>
        )}
        <Button size="l" stretched mode="filled" disabled={!selected || submitting} loading={submitting} onClick={handleConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </ScreenScroll>
  );
}

/** Пусто бывает по двум разным причинам, и человеку важно, по какой именно. */
function emptyText(sameKindCount: number): string {
  return sameKindCount > 0
    ? "В этот день все остальные на такой же смене — меняться не с кем."
    : "В этот день больше никто не работает — меняться не с кем.";
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
