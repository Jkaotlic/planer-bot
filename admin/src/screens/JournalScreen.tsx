import { useEffect, useMemo, useState } from "react";
import {
  describeAuditEvent,
  formatAuditMoment,
  auditMonthRange,
  countsPeriodPresets,
  countsValue,
  groupKinds,
  heatBackground,
  heatLevel,
  sortCountsRows,
  SCHEDULE_ACCENT_PALETTES,
  type CountsKey,
  type ShiftCountsKind,
} from "@planer/shared";
import { apiClient, AuthRequiredError, type JournalPage, type ShiftCountsReport } from "../api/client";
import { Segmented } from "../components/Segmented";
import { initialsOf, personPalette } from "../lib/people";
import { toISODate } from "../lib/week";

/** Одна строка ленты «кто что менял»: значок, фраза, кто и когда, подробности.
 *  Текст целиком приходит из `describeAuditEvent` — тот же, что видит мини-апп. */
export function JournalEventRow({ event }: { event: JournalPage["events"][number] }) {
  const view = describeAuditEvent(event);
  return (
    <div className="journal-row">
      <span className="journal-icon" aria-hidden>{view.icon}</span>
      <div className="journal-body">
        <div className="journal-head">
          <span className="journal-type">{view.title}</span>
          <span className="journal-meta">
            {event.actorName ?? "система"} · {formatAuditMoment(event.createdAt)}
          </span>
        </div>
        {view.lines.map((line, i) => (
          <div className="journal-line" key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}

type Tab = "report" | "history";

const JOURNAL_TABS: readonly { key: Tab; label: string }[] = [
  { key: "report", label: "Кто сколько отдежурил" },
  { key: "history", label: "Кто что менял" },
];

/** «Журнал»: who did how many of each kind, and who changed what and when. */
export function JournalScreen() {
  const [tab, setTab] = useState<Tab>("report");

  return (
    <div className="employees-screen">
      <div className="employees-header">
        <h2 className="employees-title">Журнал</h2>
      </div>
      <div className="segmented-row">
        <Segmented aria-label="Раздел журнала" options={JOURNAL_TABS} value={tab} onChange={setTab} />
      </div>

      {tab === "report" ? <ShiftCounts /> : <History />}
    </div>
  );
}

type SortKey = CountsKey | "name";

const sameKey = (a: SortKey, b: SortKey) => JSON.stringify(a) === JSON.stringify(b);

/** Квадратик цвета вида: тот же цвет, что у клетки в графике, — по нему вид узнают. */
function KindSwatch({ kind }: { kind: ShiftCountsKind }) {
  const bg = kind.accent ? SCHEDULE_ACCENT_PALETTES[kind.accent].bg : "var(--hint)";
  return <span className="counts-swatch" style={{ background: bg }} aria-hidden />;
}

function ShiftCounts() {
  // Локальная дата, как во всей консоли (`toISODate`), а не UTC: с `toISOString`
  // 1-го числа до трёх ночи по Москве «Этот месяц» показывал прошлый.
  const today = toISODate(new Date());
  const initial = auditMonthRange(today);
  const presets = countsPeriodPresets(today);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [report, setReport] = useState<ShiftCountsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // По умолчанию — у кого больше всего дежурств: вкладку открывают проверить
  // справедливость, а не найти человека по алфавиту (его ответ от 2026-09-29).
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: { group: "duty" }, dir: "desc" });

  async function load(range: { from: string; to: string } = { from, to }) {
    setBusy(true);
    setError(null);
    try {
      setReport(await apiClient.getShiftCounts(range.from, range.to));
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

  function pickPreset(preset: { from: string; to: string }) {
    setFrom(preset.from);
    setTo(preset.to);
    void load(preset);
  }

  function sortBy(key: SortKey) {
    setSort((current) =>
      sameKey(current.key, key)
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" },
    );
  }

  const arrow = (key: SortKey) => (sameKey(sort.key, key) ? (sort.dir === "desc" ? " ▾" : " ▴") : "");

  const view = useMemo(() => {
    if (!report) return null;
    const groups = groupKinds(report.kinds);
    // Максимум — по столбцу: цвет говорит «больше остальных в ЭТОМ виде», а не
    // «больше всего вообще» — иначе «День» с его сотнями выбелил бы всё остальное.
    const maxOf = (key: CountsKey) => Math.max(0, ...report.rows.map((row) => countsValue(row, key)));
    const max = new Map<string, number>();
    for (const g of groups) {
      max.set(`g:${g.group}`, maxOf({ group: g.group }));
      for (const k of g.kinds) max.set(`k:${k.name}`, maxOf({ kind: k.name }));
    }
    return { groups, max, rows: sortCountsRows(report.rows, sort.key, sort.dir) };
  }, [report, sort]);

  async function download() {
    setError(null);
    try {
      const csv = await apiClient.getShiftCountsCsv(from, to);
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
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
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={`btn btn-secondary${preset.from === from && preset.to === to ? " active" : ""}`}
            disabled={busy}
            onClick={() => pickPreset(preset)}
          >
            {preset.label}
          </button>
        ))}
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

      {view && view.rows.length === 0 && <div className="employees-empty">За этот период смен не было.</div>}

      {view && view.rows.length > 0 && (
        <>
          <div className="journal-table-scroll">
            <table className="counts-table">
              <thead>
                <tr>
                  <th rowSpan={2} className="counts-name sortable" onClick={() => sortBy("name")}>
                    Работник{arrow("name")}
                  </th>
                  {view.groups.map((g) => (
                    <th key={g.group} colSpan={g.kinds.length + 1} className={`counts-group counts-group-${g.group}`}>
                      {g.title}
                    </th>
                  ))}
                </tr>
                <tr>
                  {view.groups.map((g) => [
                    ...g.kinds.map((kind) => (
                      <th key={`k:${kind.name}`} className="sortable" onClick={() => sortBy({ kind: kind.name })}>
                        <KindSwatch kind={kind} />
                        {kind.name}
                        {arrow({ kind: kind.name })}
                      </th>
                    )),
                    <th key={`g:${g.group}`} className="counts-group-total sortable" onClick={() => sortBy({ group: g.group })}>
                      итого{arrow({ group: g.group })}
                    </th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => {
                  const palette = personPalette(row.employeeId);
                  return (
                    <tr key={row.employeeId}>
                      <td className="counts-name">
                        <span className="counts-person">
                          <span className="avatar avatar-sm" style={{ background: palette.bg, color: palette.fg }}>
                            {initialsOf(row.displayName)}
                          </span>
                          {row.displayName}
                        </span>
                      </td>
                      {view.groups.map((g) => [
                        ...g.kinds.map((kind) => {
                          const value = countsValue(row, { kind: kind.name });
                          return (
                            // Ноль — прочерком: глаз должен цепляться за числа.
                            <td
                              key={`k:${kind.name}`}
                              className={value ? "" : "counts-zero"}
                              style={{ background: heatBackground(g.group, heatLevel(value, view.max.get(`k:${kind.name}`) ?? 0)) }}
                            >
                              {value || "—"}
                            </td>
                          );
                        }),
                        <td
                          key={`g:${g.group}`}
                          className={`counts-group-total${row.byGroup[g.group] ? "" : " counts-zero"}`}
                          style={{ background: heatBackground(g.group, heatLevel(row.byGroup[g.group], view.max.get(`g:${g.group}`) ?? 0)) }}
                        >
                          {row.byGroup[g.group] || "—"}
                        </td>,
                      ])}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="counts-legend">
            Чем насыщеннее цвет, тем больше у человека относительно остальных в этом столбце. Клик по заголовку —
            сортировка.
          </div>
        </>
      )}
    </>
  );
}

const PAGE = 50;

function History() {
  const [page, setPage] = useState<JournalPage | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [actor, setActor] = useState("");
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by «Повторить». Без него перечитать журнал нечем: эффект зависит от
   *  фильтров и страницы, а их органы управления при ошибке исчезают с экрана. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getJournal({ types, actor: actor ? Number(actor) : undefined, limit: PAGE, offset })
      .then((next) => {
        if (cancelled) return;
        setPage(next);
        // Прошлая неудача больше не про то, что сейчас на экране.
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled || err instanceof AuthRequiredError) return;
        setError(err instanceof Error ? err.message : "Не удалось загрузить журнал");
      });
    return () => {
      cancelled = true;
    };
  }, [types, actor, offset, attempt]);

  if (error) {
    return (
      <div className="journal-controls">
        <span className="employees-error">{error}</span>
        <button type="button" className="btn btn-secondary" onClick={() => setAttempt((n) => n + 1)}>
          Повторить
        </button>
      </div>
    );
  }
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
              {describeAuditEvent({ type, payload: {} }).title}
            </option>
          ))}
        </select>
        {/* Фильтр серверный, а не по загруженной странице: total и пагинация считаются
            на сервере, и клиентский фильтр заставил бы экран врать про то, сколько
            всего событий нашлось. */}
        <select
          aria-label="Кто"
          value={actor}
          onChange={(e) => {
            setOffset(0);
            setActor(e.target.value);
          }}
        >
          <option value="">Все</option>
          {page.availableActors.map((available) => (
            <option value={String(available.id)} key={available.id}>
              {available.displayName}
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
            <JournalEventRow event={event} key={event.id} />
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
