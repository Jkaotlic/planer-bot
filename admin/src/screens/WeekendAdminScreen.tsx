import { useEffect, useState } from "react";
import { apiClient, type AdminSlotView, type PayrollRow, type SlotInterest } from "../api/client";
import { initialsOf, personPalette, pluralizeRu } from "../lib/people";
import { formatDayLabel } from "../lib/week";

/** First & last calendar day of the month containing `d`, as "YYYY-MM-DD". */
function monthRange(d: Date): { from: string; to: string } {
  const y = d.getFullYear();
  const m = d.getMonth();
  const iso = (day: Date) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
}

/** "Работа в выходные дни": open vacant slots with fairness-ranked volunteers to assign, and a payroll ledger with CSV export. */
export function WeekendAdminScreen() {
  const [slots, setSlots] = useState<AdminSlotView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPost, setShowPost] = useState(false);

  async function reloadSlots() {
    setSlots(await apiClient.getWeekendSlots());
  }

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getWeekendSlots()
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
    setBusy(true);
    setError(null);
    try {
      await apiClient.assignSlot(slotId, employeeId);
      await reloadSlots();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось назначить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="employees-screen">
      <div className="employees-header">
        <h2 className="employees-title">Работа в выходные дни</h2>
        <button type="button" className="btn btn-primary" onClick={() => setShowPost(true)}>
          ＋ Открыть смену
        </button>
      </div>

      {error && <div className="error-text">{error}</div>}

      <section className="employees-section">
        <h3 className="employees-section-title">Открытые смены</h3>
        {!slots ? (
          <div className="employees-empty">Загрузка…</div>
        ) : slots.length === 0 ? (
          <div className="employees-empty">Нет открытых смен. Нажми «Открыть смену», чтобы позвать желающих.</div>
        ) : (
          <div className="weekend-slot-list">
            {slots.map((view) => (
              <SlotCard key={view.slot.id} view={view} busy={busy} onAssign={handleAssign} />
            ))}
          </div>
        )}
      </section>

      <PayrollSection onError={setError} />

      {showPost && (
        <PostSlotDialog
          onCancel={() => setShowPost(false)}
          onCreated={async () => {
            setShowPost(false);
            await reloadSlots();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function SlotCard({ view, busy, onAssign }: { view: AdminSlotView; busy: boolean; onAssign: (slotId: number, employeeId: number) => void }) {
  const { slot, interested } = view;
  return (
    <div className="weekend-slot-card">
      <div className="weekend-slot-head">
        <div>
          <div className="weekend-slot-title">{slot.title ?? "Работа в выходной"}</div>
          <div className="weekend-slot-when">
            {formatDayLabel(slot.date)} · {slot.start}–{slot.end}
          </div>
          {slot.location && <div className="weekend-slot-meta">📍 {slot.location}</div>}
          {slot.note && <div className="weekend-slot-meta">💬 {slot.note}</div>}
        </div>
        <span className="weekend-slot-count">
          {interested.length} {pluralizeRu(interested.length, "желающий", "желающих", "желающих")}
        </span>
      </div>

      {interested.length === 0 ? (
        <div className="weekend-slot-empty">Пока никто не откликнулся — уведомление ушло всем.</div>
      ) : (
        <div className="weekend-interest-list">
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
    </div>
  );
}

function InterestRow({ person, recommended, busy, onAssign }: { person: SlotInterest; recommended: boolean; busy: boolean; onAssign: () => void }) {
  const palette = personPalette(person.employeeId);
  const n = person.confirmedThisMonth;
  return (
    <div className="weekend-interest-row">
      <span className="avatar" style={{ background: palette.bg, color: palette.fg }}>
        {initialsOf(person.name)}
      </span>
      <span className="weekend-interest-name">{person.name}</span>
      {recommended && <span className="weekend-fair-badge">★ реже всех работал</span>}
      <span className={`weekend-month-count${n === 0 ? " zero" : n >= 2 ? " high" : ""}`}>
        {n === 0 ? "ещё не работал в этом месяце" : `${n} ${pluralizeRu(n, "раз", "раза", "раз")} в этом месяце`}
        {person.passedOver > 0 &&
          ` · пропустили ${person.passedOver} ${pluralizeRu(person.passedOver, "раз", "раза", "раз")}`}
      </span>
      <span className="employee-row-spacer" />
      <button type="button" className="btn btn-primary" onClick={onAssign} disabled={busy}>
        Назначить
      </button>
    </div>
  );
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
      // BOM so Excel reads UTF-8 (Cyrillic) correctly.
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
    <section className="employees-section">
      <h3 className="employees-section-title">Учёт часов (для оплаты)</h3>
      <div className="weekend-payroll-controls">
        <label className="weekend-date-field">
          <span>С</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="weekend-date-field">
          <span>По</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
          {loading ? "…" : "Показать"}
        </button>
        <span className="employee-row-spacer" />
        <button type="button" className="btn btn-primary" onClick={() => void exportCsv()} disabled={!rows || rows.length === 0}>
          ⬇ Экспорт CSV
        </button>
      </div>

      {!rows ? (
        <div className="employees-empty">Загрузка…</div>
      ) : rows.length === 0 ? (
        <div className="employees-empty">За выбранный период нет подтверждённых смен.</div>
      ) : (
        <table className="weekend-payroll-table">
          <thead>
            <tr>
              <th>Работник</th>
              <th>Дата</th>
              <th className="num">Часы</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.employeeId}-${r.date}-${i}`}>
                <td>{r.employeeName}</td>
                <td>{formatDayLabel(r.date)}</td>
                <td className="num">{r.hours}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Итого</td>
              <td className="num">{totalHours}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}

function PostSlotDialog({ onCancel, onCreated, onError }: { onCancel: () => void; onCreated: () => Promise<void>; onError: (msg: string | null) => void }) {
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
    onError(null);
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
    <div className="panel-overlay" onClick={onCancel}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <span className="panel-title">Открыть смену на выходной</span>
          <button type="button" className="panel-close" onClick={onCancel} aria-label="Закрыть">
            ×
          </button>
        </div>

        <div className="field-group">
          <label className="field-label" htmlFor="slot-date">Дата</label>
          <input id="slot-date" type="date" value={date} autoFocus onChange={(e) => setDate(e.target.value)} />
        </div>

        <div className="weekend-time-row">
          <div className="field-group">
            <label className="field-label" htmlFor="slot-start">Начало</label>
            <input id="slot-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="slot-end">Конец</label>
            <input id="slot-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>

        <div className="field-group">
          <label className="field-label" htmlFor="slot-title">Название (необязательно)</label>
          <input id="slot-title" type="text" value={title} placeholder="Например, Ярмарка выходного дня" onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="field-group">
          <label className="field-label" htmlFor="slot-location">Место (необязательно)</label>
          <input id="slot-location" type="text" value={location} placeholder="Например, ТЦ Авиапарк" onChange={(e) => setLocation(e.target.value)} />
        </div>

        <div className="field-group">
          <label className="field-label" htmlFor="slot-note">Заметка (необязательно)</label>
          <input id="slot-note" type="text" value={note} placeholder="Например, оплата в двойном размере" onChange={(e) => setNote(e.target.value)} />
        </div>

        {localError && <div className="error-text">{localError}</div>}

        <div className="panel-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
            Отмена
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? "Публикация…" : "Позвать желающих"}
          </button>
        </div>
      </div>
    </div>
  );
}
