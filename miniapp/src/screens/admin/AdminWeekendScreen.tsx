import { useEffect, useState } from "react";
import { Avatar, Button, Input, List, Placeholder, Section, Spinner } from "@telegram-apps/telegram-ui";
import { apiClient, type AdminSlotView, type PayrollRow, type SlotInterest } from "../../api/client";
import { CardShell, CardStack, MetaLine } from "../../components/Card";
import { ScreenScroll } from "../../components/ScreenScroll";
import { formatDayLabel } from "../../lib/week";
import { pluralizeRu } from "../../lib/shift";
import { initialsOf, personPalette } from "../../lib/people";
import { useIsDark } from "../../lib/theme";

/** First & last calendar day of the month containing `d`, as "YYYY-MM-DD". */
function monthRange(d: Date): { from: string; to: string } {
  const iso = (day: Date) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const y = d.getFullYear();
  const m = d.getMonth();
  return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
}

/**
 * "Работа в выходные дни" (admin): open vacant weekend slots with their fairness-ranked
 * volunteers to assign in one tap, plus a payroll ledger with CSV export.
 * Mirrors the desktop `WeekendAdminScreen`, rebuilt as a mobile column.
 */
export function AdminWeekendScreen() {
  const [slots, setSlots] = useState<AdminSlotView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showPost, setShowPost] = useState(false);

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
    setBusyId(slotId);
    setError(null);
    try {
      await apiClient.assignSlot(slotId, employeeId);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось назначить");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScreenScroll>
      <List>
        <Section header="Открыть смену">
          <CardStack>
            {showPost ? (
              <PostSlotForm
                onCancel={() => setShowPost(false)}
                onCreated={async () => {
                  setShowPost(false);
                  await reload();
                }}
              />
            ) : (
              <Button size="m" mode="filled" stretched onClick={() => setShowPost(true)}>
                ＋ Открыть смену на выходной
              </Button>
            )}
          </CardStack>
        </Section>

        {error && (
          <Section>
            <div style={{ padding: "8px 20px", color: "var(--tgui--destructive_text_color)", fontSize: 14 }}>{error}</div>
          </Section>
        )}

        <Section header="Открытые смены">
          {!slots ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
              <Spinner size="m" />
            </div>
          ) : slots.length === 0 ? (
            <Placeholder description="Нет открытых смен. Открой смену, чтобы позвать желающих." />
          ) : (
            <CardStack>
              {slots.map((view) => (
                <SlotCard key={view.slot.id} view={view} busy={busyId === view.slot.id} onAssign={handleAssign} />
              ))}
            </CardStack>
          )}
        </Section>

        <PayrollSection onError={setError} />
      </List>
    </ScreenScroll>
  );
}

function SlotCard({ view, busy, onAssign }: { view: AdminSlotView; busy: boolean; onAssign: (slotId: number, employeeId: number) => void }) {
  const { slot, interested } = view;
  return (
    <CardShell>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 15.5 }}>{slot.title ?? "Работа в выходной"}</div>
        <span style={{ flex: "none", fontSize: 12.5, color: "var(--tgui--hint_color)", whiteSpace: "nowrap" }}>
          {interested.length} {pluralizeRu(interested.length, "желающий", "желающих", "желающих")}
        </span>
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 500 }}>
        {formatDayLabel(slot.date)} · {slot.start}–{slot.end}
      </div>
      {slot.location && <MetaLine icon="📍">{slot.location}</MetaLine>}
      {slot.note && <MetaLine icon="💬">{slot.note}</MetaLine>}

      {interested.length === 0 ? (
        <div style={{ marginTop: 6, fontSize: 13.5, color: "var(--tgui--hint_color)" }}>
          Пока никто не откликнулся — уведомление ушло всем.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          {interested.map((person, i) => (
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
    </CardShell>
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
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Avatar acronym={initialsOf(person.name)} size={28} style={{ background: palette.bg, color: palette.fg, flex: "none" }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontWeight: 500, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{person.name}</span>
          {recommended && <FairBadge />}
        </div>
        <div style={{ fontSize: 12.5, color: n === 0 ? "var(--tgui--hint_color)" : "var(--tgui--text_color)" }}>{countLabel}{passedLabel}</div>
      </div>
      <Button size="s" mode="filled" loading={busy} disabled={busy} onClick={onAssign} style={{ flex: "none" }}>
        Назначить
      </Button>
    </div>
  );
}

/** "★ реже всех работал" — the fairness hint on the volunteer with fewest weekends worked. */
function FairBadge() {
  const isDark = useIsDark();
  const palette = isDark ? { bg: "rgba(240,170,60,0.22)", fg: "#F4C169" } : { bg: "#FCEEDA", fg: "#8A5700" };
  return (
    <span style={{ flex: "none", fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: "2px 8px", background: palette.bg, color: palette.fg, whiteSpace: "nowrap" }}>
      ★ реже всех работал
    </span>
  );
}

function PostSlotForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => Promise<void> }) {
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
      await apiClient.postSlot({ date, start, end, title: title || undefined, location: location || undefined, note: note || undefined });
      await onCreated();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Не удалось открыть смену");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CardShell>
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
      {localError && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{localError}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <Button size="m" mode="filled" stretched loading={saving} disabled={saving} onClick={() => void submit()}>
          Позвать желающих
        </Button>
        <Button size="m" mode="gray" disabled={saving} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </CardShell>
  );
}

function hoursLabel(hours: number): string {
  const rounded = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  return `${rounded} ${pluralizeRu(Math.round(hours), "час", "часа", "часов")}`;
}

function PayrollSection({ onError }: { onError: (msg: string | null) => void }) {
  const initial = monthRange(new Date());
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [rows, setRows] = useState<PayrollRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    onError(null);
    try {
      setRows(await apiClient.getPayroll(from, to));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Не удалось загрузить учёт часов");
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
    onError(null);
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
      onError(err instanceof Error ? err.message : "Не удалось выгрузить CSV");
    }
  }

  const totalHours = rows?.reduce((sum, r) => sum + r.hours, 0) ?? 0;

  return (
    <Section header="Учёт часов (для оплаты)">
      <CardStack>
        <CardShell>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Input header="С" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <Input header="По" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <Button size="s" mode="gray" stretched loading={loading} disabled={loading} onClick={() => void load()}>
              Показать
            </Button>
            <Button size="s" mode="filled" stretched disabled={!rows || rows.length === 0} onClick={() => void exportCsv()}>
              ⬇ Экспорт CSV
            </Button>
          </div>
        </CardShell>

        {rows && rows.length > 0 && (
          <CardShell>
            {rows.map((r, i) => (
              <div
                key={`${r.employeeId}-${r.date}-${i}`}
                style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14, padding: "3px 0" }}
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
          </CardShell>
        )}
        {rows && rows.length === 0 && (
          <Placeholder description="За выбранный период нет подтверждённых смен." />
        )}
      </CardStack>
    </Section>
  );
}
