import { useEffect, useState } from "react";
import { Avatar, Input, Placeholder, Spinner } from "@telegram-apps/telegram-ui";
import { apiClient, type AdminSlotView, type PayrollRow, type SlotInterest } from "../../api/client";
import { formatDayLabel } from "../../lib/week";
import { pluralizeRu } from "../../lib/shift";
import { initialsOf, personPalette } from "../../lib/people";
import { categoryLabel, useCategoryPalette, type Category } from "../../categories";
import { withBusy, withoutBusy } from "../../lib/busy-set";
import { ConfirmButton } from "../../components/ConfirmButton";
import { ActionButton, Card, Group, MetaLine, StatusPill } from "../../ui";

/**
 * First & last calendar day of the month containing `today` ("YYYY-MM-DD" —
 * команднАЯ дата, не часы браузера), as "YYYY-MM-DD".
 *
 * Разбирает строку вручную, а не через `new Date(today)`: дата без времени
 * парсится как UTC-полночь, а `getFullYear`/`getMonth` ниже читают её
 * локальными часами — в поясах западнее UTC результат съезжал бы на день
 * назад. Локальный `Date` строится только для арифметики «последний день
 * месяца» (`new Date(y, m, 0)`), где он и безопасен.
 */
function monthRange(today: string): { from: string; to: string } {
  const iso = (day: Date) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const [y, m] = today.split("-").map(Number) as [number, number];
  return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
}

/**
 * "Работа в выходные дни" (admin): open vacant weekend slots with their fairness-ranked
 * volunteers to assign in one tap, plus a payroll ledger with CSV export.
 * Mirrors the desktop `WeekendAdminScreen`, rebuilt as a mobile column.
 */
/**
 * What to say after opening a weekend slot.
 *
 * The call for volunteers only reaches people who have linked Telegram, and a
 * bare «смена открыта» reads as «спросил команду» even when it asked a third of
 * it. Mirrored in the desktop console — see WeekendAdminScreen.tsx.
 */
/**
 * Что сказать после назначения на выходной. `null` — всё дошло или письма не
 * было (повторное назначение) — говорить не о чем.
 *
 * Запись в графике появляется сразу, и без этой строки админ считал человека
 * предупреждённым, хотя письмо не дошло (нет Telegram, бот заблокирован).
 */
export function assignNotice(notified: boolean | undefined): string | null {
  return notified === false ? "Назначено, но сообщение в Telegram не дошло — предупреди человека лично." : null;
}

export function reachNotice(delivered: number, intended: number): string {
  if (delivered >= intended) return `Смена открыта — спросили всю команду (${intended}).`;
  return `Смена открыта, но уведомление дошло до ${delivered} из ${intended}: остальные ещё не подключили телеграм.`;
}

/**
 * Что сказать после «Набрали, закрыть». Число — сколько желающих без назначения
 * получили «уже набрали»: без него админ не знал, ушёл ли кому-то отбой, и
 * отписывался в чат команды руками. Зеркало — в консоли.
 */
export function closeNotice(toldOff: number): string {
  return `Закрыто. Написали желающим: ${toldOff}`;
}

export function AdminWeekendScreen({
  /** Командная дата из bootstrap (`data.today`), а не часы телефона: без неё
   *  учёт часов по умолчанию открывался на месяце браузера, а не команды —
   *  баг из ledger, тот же, что и в «Сборах». */
  today,
}: {
  today: string;
}) {
  const [slots, setSlots] = useState<AdminSlotView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One slot's assign/unassign in flight must not re-enable another slot's
  // buttons — a single shared id would let a tap on slot B clear slot A's busy
  // state while A's own request is still running.
  const [busySlotIds, setBusySlotIds] = useState<ReadonlySet<number>>(new Set());
  const [showPost, setShowPost] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** «Не дошло» — красным, а не серой строкой рядом с обычными отчётами. */
  const [warning, setWarning] = useState<string | null>(null);

  async function reload() {
    setSlots(await apiClient.getAdminWeekendSlots());
  }

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getAdminWeekendSlots()
      .then((s) => {
        if (!cancelled) setSlots(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить биржу");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAssign(slotId: number, employeeId: number) {
    setBusySlotIds((prev) => withBusy(prev, slotId));
    setError(null);
    try {
      const { notified } = await apiClient.assignSlot(slotId, employeeId);
      setNotice(null);
      setWarning(assignNotice(notified));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось назначить");
    } finally {
      setBusySlotIds((prev) => withoutBusy(prev, slotId));
    }
  }

  async function handleUnassign(slotId: number, assignmentId: number) {
    setBusySlotIds((prev) => withBusy(prev, slotId));
    setError(null);
    try {
      await apiClient.unassignSlot(assignmentId);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось снять");
    } finally {
      setBusySlotIds((prev) => withoutBusy(prev, slotId));
    }
  }

  async function handleClose(slotId: number) {
    setBusySlotIds((prev) => withBusy(prev, slotId));
    setError(null);
    try {
      const { toldOff } = await apiClient.closeSlot(slotId);
      setWarning(null);
      setNotice(closeNotice(toldOff));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось закрыть смену");
    } finally {
      setBusySlotIds((prev) => withoutBusy(prev, slotId));
    }
  }

  // Закрытые («набрали») сервер отдаёт до их даты, чтобы было видно, кто
  // выходит, — но отдельным блоком: в «Открытых» они читались бы как ещё
  // ждущие желающих.
  const openSlots = slots?.filter((v) => v.slot.status !== "closed") ?? null;
  const closedSlots = slots?.filter((v) => v.slot.status === "closed") ?? [];

  // Экран живёт внутри `Screen` из `AdminScreen`: ни своих отступов, ни заголовка.
  return (
    <>
      <Group header="Открыть смену">
        {showPost ? (
          <PostSlotForm
            onCancel={() => setShowPost(false)}
            onCreated={async (reach) => {
              setShowPost(false);
              setWarning(null);
              setNotice(reachNotice(reach.delivered, reach.intended));
              await reload();
            }}
          />
        ) : (
          // Единственная главная кнопка раздела: «Назначить» в карточках слотов их
          // несколько в одной карточке, и ни одна не главнее соседней.
          <ActionButton kind="primary" stretched onClick={() => setShowPost(true)}>
            ＋ Открыть смену на выходной
          </ActionButton>
        )}
      </Group>

      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-body)" }}>{error}</div>}
      {notice && (
        <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-body)" }} role="status">
          {notice}
        </div>
      )}
      {warning && (
        <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-body)" }} role="status">
          {warning}
        </div>
      )}

      <Group header="Открытые смены">
        {!openSlots ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
            <Spinner size="m" />
          </div>
        ) : openSlots.length === 0 ? (
          <Placeholder description="Нет открытых смен. Открой смену, чтобы позвать желающих." />
        ) : (
          openSlots.map((view) => (
            <SlotCard
              key={view.slot.id}
              view={view}
              busy={busySlotIds.has(view.slot.id)}
              onAssign={handleAssign}
              onUnassign={(assignmentId) => handleUnassign(view.slot.id, assignmentId)}
              onClose={() => void handleClose(view.slot.id)}
            />
          ))
        )}
      </Group>

      {closedSlots.length > 0 && (
        <Group header="Закрытые">
          {closedSlots.map((view) => (
            <SlotCard
              key={view.slot.id}
              view={view}
              busy={busySlotIds.has(view.slot.id)}
              onAssign={handleAssign}
              onUnassign={(assignmentId) => handleUnassign(view.slot.id, assignmentId)}
            />
          ))}
        </Group>
      )}

      <PayrollSection today={today} />
    </>
  );
}

function SlotCard({
  view,
  busy,
  onAssign,
  onUnassign,
  onClose,
}: {
  view: AdminSlotView;
  busy: boolean;
  onAssign: (slotId: number, employeeId: number) => void;
  onUnassign: (assignmentId: number) => void;
  /** Нет у закрытого слота — второй раз «набрали» сказать нечего. */
  onClose?: () => void;
}) {
  const { slot, interested, assignees } = view;
  const assignedIds = new Set(assignees.map((a) => a.employeeId));
  const closed = slot.status === "closed";
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: "var(--app-text-head)" }}>{slot.title ?? "Работа в выходной"}</div>
        <span style={{ flex: "none", fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)", whiteSpace: "nowrap" }}>
          {closed
            ? "Закрыта — набрали"
            : `${interested.length} ${pluralizeRu(interested.length, "желающий", "желающих", "желающих")}`}
        </span>
      </div>
      <div style={{ fontSize: "var(--app-text-body)", fontWeight: 500 }}>
        {formatDayLabel(slot.date)} · {slot.start}–{slot.end}
      </div>
      {slot.location && <MetaLine icon="📍">{slot.location}</MetaLine>}
      {slot.note && <MetaLine icon="💬">{slot.note}</MetaLine>}

      {assignees.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          <span style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>Назначены · {assignees.length}</span>
          {assignees.map((a) => (
            <div key={a.assignmentId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "var(--app-text-body)", fontWeight: 600, flex: 1, minWidth: 0 }}>{a.name}</span>
              <span style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)", whiteSpace: "nowrap" }}>
                {a.status === "confirmed" ? "подтвердил" : "ждём ответа"}
              </span>
              <ActionButton compact disabled={busy} onClick={() => onUnassign(a.assignmentId)}>
                Снять
              </ActionButton>
            </div>
          ))}
        </div>
      )}

      {closed ? (
        // Закрытая смена уже не набирает: список желающих с «Назначить» здесь
        // обещал бы то, чего сервер не сделает, — остаются только назначенные.
        assignees.length === 0 && (
          <div style={{ marginTop: 6, fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>Никого не назначили.</div>
        )
      ) : interested.filter((p) => !assignedIds.has(p.employeeId)).length === 0 ? (
        <div style={{ marginTop: 6, fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>
          {assignees.length > 0 ? "Других желающих нет." : "Пока никто не откликнулся — уведомление ушло всем."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          {interested
            .filter((p) => !assignedIds.has(p.employeeId))
            .map((person, i) => (
              <InterestRow
                key={person.employeeId}
                person={person}
                recommended={i === 0}
                busy={busy}
                onAssign={() => onAssign(slot.id, person.employeeId)}
              />
            ))}
        </div>
      )}

      {!closed && onClose && (
        <div style={{ marginTop: 8 }}>
          <ConfirmButton
            label="Набрали, закрыть"
            question="Закрыть смену? Назначенные выходят, остальным желающим придёт «спасибо, уже набрали»."
            confirmLabel="Закрыть"
            loading={busy}
            disabled={busy}
            onConfirm={onClose}
          />
        </div>
      )}
    </Card>
  );
}

function InterestRow({ person, recommended, busy, onAssign }: { person: SlotInterest; recommended: boolean; busy: boolean; onAssign: () => void }) {
  const palette = personPalette(person.employeeId);
  const n = person.confirmedThisMonth;
  const countLabel = n === 0 ? "ещё не работал в этом месяце" : `${n} ${pluralizeRu(n, "раз", "раза", "раз")} в этом месяце`;
  // Being passed over repeatedly earns priority — surface it so the ordering reads honestly.
  const passedLabel =
    person.passedOver > 0 ? ` · пропустили ${person.passedOver} ${pluralizeRu(person.passedOver, "раз", "раза", "раз")}` : "";
  return (
    // `wrap`: на 320px справа от текста оставалось ~107px, и имя с плашкой «реже
    // всех работал» рвались на 3–5 строк, а «Даша Кузнец…» резалась. Колонке дана
    // база 150px: если её с «Назначить» в строке не вместить, кнопка уходит вниз.
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
      <Avatar acronym={initialsOf(person.name)} size={28} style={{ background: palette.bg, color: palette.fg, flex: "none" }} />
      <div style={{ minWidth: 0, flex: "1 1 150px" }}>
        {/* `wrap`: плашки «реже всех работал» / «Отпуск» не сжимаются
            (`flex: none`), и без переноса имя уходило в одну букву — замер
            2026-09-28 на 390×844: «И», «Д». Теперь плашка уходит строкой ниже,
            а имя режется многоточием, только если не влезает само по себе. */}
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
          <span style={{ fontWeight: 500, fontSize: "var(--app-text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{person.name}</span>
          {recommended && <FairBadge />}
          {person.absence && <AbsenceBadge category={person.absence} />}
        </div>
        <div style={{ fontSize: "var(--app-text-meta)", color: n === 0 ? "var(--tgui--hint_color)" : "var(--tgui--text_color)" }}>{countLabel}{passedLabel}</div>
      </div>
      {/* Не `primary`: у слота несколько желающих, и столько же «главных» кнопок. */}
      <div style={{ flex: "none", marginLeft: "auto" }}>
        <ActionButton compact loading={busy} disabled={busy} onClick={onAssign}>
          Назначить
        </ActionButton>
      </div>
    </div>
  );
}

/**
 * «Отпуск» / «Больничный» / «Командировка» — этот желающий в день смены в
 * отсутствии. Отметка, а не запрет: человек мог откликнуться в мае, а отпуск в
 * июне лёг ровно на этот день, а иногда он сам просит выйти. Решает админ — но
 * только если видит, а раньше список молчал. Зеркало консоли
 * (`admin/src/screens/WeekendAdminScreen.tsx`).
 *
 * Цвет категории отсутствия (палитра графика, как на `main`), а не серая пилюля статуса: серая
 * сливалась с «реже всех работал» и «привязан», а по цвету отпуск узнают с
 * первого взгляда там, где его уже видели.
 */
function AbsenceBadge({ category }: { category: Category }) {
  const palette = useCategoryPalette(category);
  // Размер пилюли набора (13px), а не `Chip` telegram-ui: тот выходит в
  // два раза выше и перетягивал на себя строку с именем и «Назначить».
  return (
    <span
      data-absence-chip={category}
      style={{
        flex: "0 1 auto", minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        boxSizing: "border-box", padding: "4px 10px", borderRadius: 999, fontSize: "var(--app-text-meta)", fontWeight: 600, lineHeight: 1.3,
        background: palette.bg, color: palette.fg,
      }}
    >
      {categoryLabel(category)}
    </span>
  );
}

/** "★ реже всех работал" — the fairness hint on the volunteer with fewest weekends worked. */
function FairBadge() {
  return <StatusPill tone="need">★ реже всех работал</StatusPill>;
}

function PostSlotForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (reach: { delivered: number; intended: number }) => Promise<void> }) {
  const [date, setDate] = useState("");
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("18:00");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit() {
    if (!date) {
      setLocalError("Укажите дату");
      return;
    }
    if (!start || !end) {
      setLocalError("Укажите время начала и конца");
      return;
    }
    setSaving(true);
    setLocalError(null);
    try {
      const created = await apiClient.postSlot({ date, start, end, title: title || undefined, location: location || undefined, note: note || undefined });
      await onCreated(created);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Не удалось открыть смену");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <Input header="Дата" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Input header="Начало" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <Input header="Конец" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <Input header="Название (необязательно)" placeholder="Например, Ярмарка выходного дня" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Input header="Место (необязательно)" placeholder="Например, ТЦ Авиапарк" value={location} onChange={(e) => setLocation(e.target.value)} />
      <Input header="Заметка (необязательно)" placeholder="Например, оплата в двойном размере" value={note} onChange={(e) => setNote(e.target.value)} />
      {localError && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>{localError}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        {/* Единственная `primary` формы: она завершает действие. */}
        <ActionButton kind="primary" stretched loading={saving} disabled={saving} onClick={() => void submit()}>
          Позвать желающих
        </ActionButton>
        <ActionButton disabled={saving} onClick={onCancel}>
          Отмена
        </ActionButton>
      </div>
    </Card>
  );
}

function hoursLabel(hours: number): string {
  const rounded = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  return `${rounded} ${pluralizeRu(Math.round(hours), "час", "часа", "часов")}`;
}

/**
 * Учёт часов — самая нижняя секция экрана, и её отказы уходили в общий `error`
 * наверху. Замер на 390×844: чтобы дотянуться до «Показать», экран надо
 * прокрутить на 552px, и блок ошибки оказывается на y=−368 — сотни пикселей выше
 * края. Нажал, ничего не обновилось, почему — не сказано нигде. Ответ живёт
 * здесь же. Зеркалится в консоли — см. `admin/src/screens/WeekendAdminScreen.tsx`.
 */
function PayrollSection({ today }: { today: string }) {
  const initial = monthRange(today);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [rows, setRows] = useState<PayrollRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await apiClient.getPayroll(from, to));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить учёт часов");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Load once on mount with the default month; re-fetch is manual via the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exportCsv() {
    setError(null);
    try {
      const csv = await apiClient.getPayrollCsv(from, to);
      // Leading BOM so Excel reads UTF-8 (Cyrillic) correctly.
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll-${from}_${to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выгрузить CSV");
    }
  }

  const totalHours = rows?.reduce((sum, r) => sum + r.hours, 0) ?? 0;

  return (
    <Group header="Учёт часов (для оплаты)">
      <Card>
        {/* `minWidth: 0` у обёрток и у полей: поле даты в WebKit не сжимается
            ниже своей встроенной ширины, и два в ряд раздвигали страницу вбок
            до 478px на экране 390 (замер 2026-09-28). */}
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Input header="С" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ minWidth: 0, width: "100%" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Input header="По" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ minWidth: 0, width: "100%" }} />
          </div>
        </div>
        {/* Обе обычные: главная кнопка раздела — «Открыть смену» наверху экрана. */}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <ActionButton stretched loading={loading} disabled={loading} onClick={() => void load()}>
            Показать
          </ActionButton>
          <ActionButton stretched disabled={!rows || rows.length === 0} onClick={() => void exportCsv()}>
            ⬇ Экспорт CSV
          </ActionButton>
        </div>
        {error && (
          <div style={{ marginTop: 8, color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)", lineHeight: 1.35 }}>
            {error}
          </div>
        )}
      </Card>

      {rows && rows.length > 0 && (
        <Card>
          {rows.map((r, i) => (
            <div
              key={`${r.employeeId}-${r.date}-${i}`}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "var(--app-text-body)", padding: "3px 0" }}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.employeeName}</span>
              <span style={{ flex: "none", color: "var(--tgui--hint_color)" }}>{formatDayLabel(r.date)}</span>
              <span style={{ flex: "none", fontWeight: 600 }}>{r.hours} ч</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--tgui--divider)", marginTop: 6, paddingTop: 8, fontWeight: 600 }}>
            <span>Итого</span>
            <span>{hoursLabel(totalHours)}</span>
          </div>
        </Card>
      )}
      {rows && rows.length === 0 && (
        <Placeholder description="За выбранный период нет подтверждённых смен." />
      )}
    </Group>
  );
}
