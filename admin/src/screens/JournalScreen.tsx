import { useEffect, useState } from "react";
import { apiClient, AuthRequiredError, type JournalPage, type ShiftCountsReport } from "../api/client";
import { initialsOf, personPalette } from "../lib/people";

/** What each audit type is called in the log, in words rather than in code. */
const TYPE_LABELS: Record<string, string> = {
  entry_created: "Добавлена запись",
  entry_updated: "Изменена запись",
  entry_deleted: "Удалена запись",
  distribution_applied: "Смены распределены честно",
  employee_updated: "Изменены данные работника",
  employee_reordered: "Изменён порядок людей",
  employee_archived: "Работник архивирован",
  employee_restored: "Работник восстановлен",
  employee_admin_changed: "Изменены права админа",
  template_roles_changed: "Изменено «кто что может»",
  template_rotation_changed: "Изменена очередь",
  roster_import: "Загрузка графика из CSV",
  swap_proposed: "Предложен обмен",
  swap_accepted: "Обмен состоялся",
  swap_declined: "Обмен отклонён",
  swap_cancelled: "Обмен отменён",
  weekend_slot_created: "Открыта смена на выходной",
  weekend_assigned: "Выходная смена назначена",
  birthday_sent: "Разослан сбор на день рождения",
  birthday_admin_notice: "Напоминание админам о дне рождения",
  birthday_schedule_notice: "Напоминание админам о сборе",
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

/** "5 августа, 14:32" — a log is read by when, so the date leads. */
export function formatMoment(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

/** The month around `today`, as the [from, to] the report opens on. */
export function monthRangeOf(today: Date): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const last = new Date(year, month, 0).getDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

type Tab = "report" | "history";

/** «Журнал»: who did how many of each kind, and who changed what and when. */
export function JournalScreen() {
  const [tab, setTab] = useState<Tab>("report");

  return (
    <div className="employees-screen">
      <div className="employees-header">
        <h2 className="employees-title">Журнал</h2>
      </div>
      <div className="journal-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "report"}
          className={`journal-tab${tab === "report" ? " active" : ""}`}
          onClick={() => setTab("report")}
        >
          Кто сколько отдежурил
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          className={`journal-tab${tab === "history" ? " active" : ""}`}
          onClick={() => setTab("history")}
        >
          Кто что менял
        </button>
      </div>

      {tab === "report" ? <ShiftCounts /> : <History />}
    </div>
  );
}

function ShiftCounts() {
  const initial = monthRangeOf(new Date());
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [report, setReport] = useState<ShiftCountsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      setReport(await apiClient.getShiftCounts(from, to));
    } catch (err) {
      if (!(err instanceof AuthRequiredError)) setError(err instanceof Error ? err.message : "Не удалось построить отчёт");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // Opens on the current month; after that it reloads only when asked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function download() {
    setError(null);
    try {
      const csv = await apiClient.getShiftCountsCsv(from, to);
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `kto-skolko-otdezhuril-${from}_${to}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выгрузить CSV");
    }
  }

  return (
    <>
      <div className="journal-controls">
        <label>
          С <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          По <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void load()}>
          {busy ? "…" : "Показать"}
        </button>
        <button type="button" className="btn btn-secondary" disabled={!report} onClick={() => void download()}>
          ⬇ Выгрузить CSV
        </button>
      </div>

      {error && <div className="employees-error">{error}</div>}

      {report && report.kinds.length === 0 && (
        <div className="employees-empty">За этот период смен не было.</div>
      )}

      {report && report.kinds.length > 0 && (
        <div className="journal-table-scroll">
          <table className="counts-table">
            <thead>
              <tr>
                <th className="counts-name">Работник</th>
                {report.kinds.map((kind) => (
                  <th key={kind}>{kind}</th>
                ))}
                <th className="counts-total">Всего</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => {
                const palette = personPalette(row.employeeId);
                return (
                  <tr key={row.employeeId}>
                    <td className="counts-name">
                      <span className="avatar avatar-sm" style={{ background: palette.bg, color: palette.fg }}>
                        {initialsOf(row.displayName)}
                      </span>
                      {row.displayName}
                    </td>
                    {report.kinds.map((kind) => (
                      // A zero is written as a dash: the eye should catch the numbers.
                      <td key={kind} className={row.byKind[kind] ? "" : "counts-zero"}>
                        {row.byKind[kind] ?? "—"}
                      </td>
                    ))}
                    <td className="counts-total">{row.total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const PAGE = 50;

function History() {
  const [page, setPage] = useState<JournalPage | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getJournal({ types, limit: PAGE, offset })
      .then((next) => {
        if (!cancelled) setPage(next);
      })
      .catch((err: unknown) => {
        if (cancelled || err instanceof AuthRequiredError) return;
        setError(err instanceof Error ? err.message : "Не удалось загрузить журнал");
      });
    return () => {
      cancelled = true;
    };
  }, [types, offset]);

  if (error) return <div className="employees-error">{error}</div>;
  if (!page) return <div className="employees-empty">Загрузка…</div>;

  const shown = page.offset + page.events.length;

  return (
    <>
      <div className="journal-controls">
        <select
          value={types[0] ?? ""}
          onChange={(e) => {
            setOffset(0);
            setTypes(e.target.value ? [e.target.value] : []);
          }}
        >
          <option value="">Все события</option>
          {page.availableTypes.map((type) => (
            <option value={type} key={type}>
              {typeLabel(type)}
            </option>
          ))}
        </select>
        <span className="journal-count">
          {page.total === 0 ? "пусто" : `${page.offset + 1}–${shown} из ${page.total}`}
        </span>
      </div>

      {page.events.length === 0 ? (
        <div className="employees-empty">Событий пока нет.</div>
      ) : (
        <div className="employees-list">
          {page.events.map((event) => (
            <div className="journal-row" key={event.id}>
              <span className="journal-type">{typeLabel(event.type)}</span>
              <span className="journal-actor">{event.actorName ?? "система"}</span>
              <span className="journal-when">{formatMoment(event.createdAt)}</span>
              <code className="journal-payload">{JSON.stringify(event.payload)}</code>
            </div>
          ))}
        </div>
      )}

      <div className="journal-controls">
        <button type="button" className="btn btn-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
          ← Новее
        </button>
        <button type="button" className="btn btn-secondary" disabled={shown >= page.total} onClick={() => setOffset(offset + PAGE)}>
          Старее →
        </button>
      </div>
    </>
  );
}
