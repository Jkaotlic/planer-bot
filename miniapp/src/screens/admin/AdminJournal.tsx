import { useEffect, useState } from "react";
import { Button, Input, Placeholder, SegmentedControl, Section, Spinner } from "@telegram-apps/telegram-ui";
import {
  describeAuditEvent,
  formatAuditMoment,
  auditMonthRange,
  countsKeyLabel,
  countsPeriodPresets,
  groupKinds,
  heatBackground,
  rankByKey,
  sortCountsRows,
  SCHEDULE_ACCENT_PALETTES,
  SHIFT_COUNTS_GROUPS,
  SHIFT_COUNTS_GROUP_TITLES,
  type CountsKey,
  type ShiftCountsGroup,
  type ShiftCountsKind,
} from "@planer/shared";
import { apiClient, type JournalPage, type ShiftCountsReport } from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";
import { ScreenScroll } from "../../components/ScreenScroll";
import { initialsOf, personPalette } from "../../lib/people";

/** Событие журнала карточкой. Текст — тот же, что в вебе: общий описатель. */
export function JournalEventCard({ event }: { event: JournalPage["events"][number] }) {
  const view = describeAuditEvent(event);
  return (
    <CardShell>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span aria-hidden style={{ flex: "none", fontSize: 15 }}>{view.icon}</span>
        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14.5 }}>{view.title}</span>
      </div>
      <div style={{ marginTop: 4, color: "var(--tgui--hint_color)", fontSize: 12.5 }}>
        {event.actorName ?? "система"} · {formatAuditMoment(event.createdAt)}
      </div>
      {view.lines.map((line, i) => (
        <div key={i} style={{ marginTop: 3, fontSize: 13, lineHeight: 1.45 }}>{line}</div>
      ))}
    </CardShell>
  );
}

type Tab = "report" | "history";

/**
 * «Журнал» (admin, mobile): who did how many of each kind, and who changed what.
 *
 * The report is a list of people rather than the desktop's table — a table of
 * 26 × 9 has nowhere to go on a phone, and the question a person actually asks
 * is «сколько у Мишина», not «сравни всю сетку разом».
 */
export function AdminJournal({ today }: { today: string }) {
  const [tab, setTab] = useState<Tab>("report");

  return (
    <ScreenScroll style={{ padding: "12px 12px 96px" }}>
      <div style={{ marginBottom: 12 }}>
        <SegmentedControl>
          <SegmentedControl.Item selected={tab === "report"} onClick={() => setTab("report")}>
            Кто сколько
          </SegmentedControl.Item>
          <SegmentedControl.Item selected={tab === "history"} onClick={() => setTab("history")}>
            Кто менял
          </SegmentedControl.Item>
        </SegmentedControl>
      </div>
      {tab === "report" ? <ShiftCounts today={today} /> : <History />}
    </ScreenScroll>
  );
}

type CountsMode = "kinds" | "people";

const sameKey = (a: CountsKey, b: CountsKey) => JSON.stringify(a) === JSON.stringify(b);

function Swatch({ accent }: { accent: ShiftCountsKind["accent"] }) {
  return (
    <span
      aria-hidden
      style={{
        flex: "none", display: "inline-block", width: 8, height: 8, borderRadius: 2,
        background: accent ? SCHEDULE_ACCENT_PALETTES[accent].bg : "var(--tgui--hint_color)",
        boxShadow: "0 0 0 1px rgba(0,0,0,.15)",
      }}
    />
  );
}

function Avatar({ employeeId, name, size }: { employeeId: number; name: string; size: number }) {
  const palette = personPalette(employeeId);
  return (
    <span
      style={{
        flex: "none", display: "grid", placeContent: "center", width: size, height: size,
        borderRadius: 999, fontSize: 11, fontWeight: 700, background: palette.bg, color: palette.fg,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Что можно выбрать в «По видам»: итоги групп (дежурства первыми), потом сами виды. */
function rankKeys(report: ShiftCountsReport): { key: CountsKey; group: ShiftCountsGroup; accent: ShiftCountsKind["accent"] }[] {
  const present = new Set(report.kinds.map((k) => k.group));
  const groupOrder: ShiftCountsGroup[] = ["duty", "shift", "other"];
  return [
    ...groupOrder.filter((g) => present.has(g)).map((g) => ({ key: { group: g } as CountsKey, group: g, accent: null })),
    ...groupKinds(report.kinds).flatMap((g) => g.kinds.map((k) => ({ key: { kind: k.name } as CountsKey, group: k.group, accent: k.accent }))),
  ];
}

function ShiftCounts({ today }: { today: string }) {
  const initial = auditMonthRange(today);
  const presets = countsPeriodPresets(today);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [report, setReport] = useState<ShiftCountsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // «По видам» первым: вкладку открывают проверить справедливость — кто сколько
  // ночей и дежурств взял (его ответ от 2026-09-29).
  const [mode, setMode] = useState<CountsMode>("kinds");
  const [picked, setPicked] = useState<CountsKey | null>(null);

  async function load(range: { from: string; to: string } = { from, to }) {
    setBusy(true);
    setError(null);
    try {
      setReport(await apiClient.getShiftCounts(range.from, range.to));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось построить отчёт");
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

  const keys = report ? rankKeys(report) : [];
  // Выбранный вид мог исчезнуть в новом периоде — тогда первый доступный, а не пустой рейтинг.
  const active = keys.find((k) => picked && sameKey(k.key, picked)) ?? keys[0];
  const hasAny = !!report && report.rows.some((r) => r.byGroup.shift + r.byGroup.duty + r.byGroup.other > 0);

  return (
    <Section header="Кто сколько отдежурил">
      <CardStack>
        <CardShell>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {presets.map((preset) => (
              <Button
                key={preset.label}
                size="s"
                mode={preset.from === from && preset.to === to ? "filled" : "bezeled"}
                disabled={busy}
                onClick={() => pickPreset(preset)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 13, color: "var(--tgui--link_color)", cursor: "pointer" }}>Свой период</summary>
            {/* Stacked, not side by side: two native date fields sharing a phone's
                width clip their own year — «07/01/2» — and the year is the part you
                check when picking a period. */}
            <Input header="С" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input header="По" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <Button size="s" mode="filled" stretched loading={busy} disabled={busy} style={{ marginTop: 6 }} onClick={() => void load()}>
              Показать
            </Button>
          </details>
          {error && (
            <div style={{ marginTop: 8, color: "var(--tgui--destructive_text_color)", fontSize: 13 }}>{error}</div>
          )}
        </CardShell>

        {report && !hasAny && <Placeholder description="За этот период смен не было." />}

        {report && hasAny && (
          <>
            <SegmentedControl>
              <SegmentedControl.Item selected={mode === "kinds"} onClick={() => setMode("kinds")}>
                По видам
              </SegmentedControl.Item>
              <SegmentedControl.Item selected={mode === "people"} onClick={() => setMode("people")}>
                По людям
              </SegmentedControl.Item>
            </SegmentedControl>

            {mode === "kinds" && active && <ByKind report={report} keys={keys} active={active} onPick={setPicked} />}
            {mode === "people" && <ByPerson report={report} />}
          </>
        )}
      </CardStack>
    </Section>
  );
}

function ByKind({
  report, keys, active, onPick,
}: {
  report: ShiftCountsReport;
  keys: ReturnType<typeof rankKeys>;
  active: ReturnType<typeof rankKeys>[number];
  onPick: (key: CountsKey) => void;
}) {
  const ranked = rankByKey(report.rows, active.key);
  return (
    <>
      {/* Плашки прокручиваются своей полосой: страница вбок не едет на узком экране. */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", flexWrap: "nowrap", paddingBottom: 2 }}>
        {keys.map((k) => {
          const selected = sameKey(k.key, active.key);
          return (
            <button
              // Ключ — сам ключ, а не подпись: вид с именем «Все смены» совпал бы с итогом группы.
              key={JSON.stringify(k.key)}
              type="button"
              onClick={() => onPick(k.key)}
              style={{
                flex: "none", display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px",
                borderRadius: 999, border: "1px solid var(--tgui--outline)", fontSize: 13,
                fontWeight: "group" in k.key ? 700 : 500, cursor: "pointer",
                background: selected ? "var(--tgui--button_color)" : "var(--tgui--bg_color)",
                color: selected ? "var(--tgui--button_text_color)" : "var(--tgui--text_color)",
              }}
            >
              {"kind" in k.key && <Swatch accent={k.accent} />}
              {countsKeyLabel(k.key)}
            </button>
          );
        })}
      </div>

      <CardShell>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{countsKeyLabel(active.key)}</div>
        {ranked.length === 0 ? (
          <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>
            За этот период никто не брал «{countsKeyLabel(active.key)}».
          </div>
        ) : (
          ranked.map(({ row, value, share }) => (
            <div key={row.employeeId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
              <Avatar employeeId={row.employeeId} name={row.displayName} size={26} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {row.displayName}
                </div>
                <div style={{ marginTop: 4, height: 6, borderRadius: 3, background: "var(--tgui--secondary_bg_color)" }}>
                  <div style={{ width: `${share * 100}%`, height: "100%", borderRadius: 3, background: heatBackground(active.group, 4) }} />
                </div>
              </div>
              <span style={{ flex: "none", minWidth: 24, textAlign: "right", fontWeight: 700, fontSize: 15 }}>{value}</span>
            </div>
          ))
        )}
      </CardShell>
    </>
  );
}

function ByPerson({ report }: { report: ShiftCountsReport }) {
  const groups = groupKinds(report.kinds);
  return (
    <>
      {sortCountsRows(report.rows, { group: "duty" }, "desc").map((row) => (
        <CardShell key={row.employeeId}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar employeeId={row.employeeId} name={row.displayName} size={30} />
            <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 15 }}>{row.displayName}</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {SHIFT_COUNTS_GROUPS.map((g) => {
              const value = row.byGroup[g];
              return (
                <div key={g} style={{ flex: 1, padding: "6px 8px", borderRadius: 10, background: heatBackground(g, value ? 1 : 0) }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: value ? undefined : "var(--tgui--hint_color)" }}>{value}</div>
                  <div style={{ fontSize: 11, color: "var(--tgui--hint_color)" }}>{SHIFT_COUNTS_GROUP_TITLES[g]}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {groups.flatMap((g) =>
              g.kinds
                .filter((kind) => row.byKind[kind.name])
                .map((kind) => (
                  <span
                    key={kind.name}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 999,
                      fontSize: 12.5, background: heatBackground(g.group, 2),
                    }}
                  >
                    <Swatch accent={kind.accent} />
                    {kind.name} <b>{row.byKind[kind.name]}</b>
                  </span>
                )),
            )}
          </div>
        </CardShell>
      ))}
    </>
  );
}

const PAGE = 30;

function History() {
  const [page, setPage] = useState<JournalPage | null>(null);
  const [type, setType] = useState("");
  const [actor, setActor] = useState("");
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by «Повторить». Без него перечитать журнал нечем: эффект зависит от
   *  фильтров и страницы, а их органы управления при ошибке исчезают с экрана. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getJournal({ types: type ? [type] : [], actor: actor ? Number(actor) : undefined, limit: PAGE, offset })
      .then((next) => {
        if (cancelled) return;
        setPage(next);
        // Прошлая неудача больше не про то, что сейчас на экране.
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить журнал");
      });
    return () => {
      cancelled = true;
    };
  }, [type, actor, offset, attempt]);

  if (error) {
    return (
      <Section header="Кто что менял">
        <CardStack>
          <CardShell>
            <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 14 }}>{error}</div>
            <Button size="s" mode="gray" stretched style={{ marginTop: 8 }} onClick={() => setAttempt((n) => n + 1)}>
              Повторить
            </Button>
          </CardShell>
        </CardStack>
      </Section>
    );
  }
  if (!page) {
    return (
      <Section header="Кто что менял">
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <Spinner size="m" />
        </div>
      </Section>
    );
  }

  const shown = page.offset + page.events.length;

  return (
    <Section header="Кто что менял">
      <CardStack>
        <CardShell>
          <select
            value={type}
            onChange={(e) => {
              setOffset(0);
              setType(e.target.value);
            }}
            style={{
              width: "100%", padding: "8px 10px", borderRadius: 8,
              border: "1px solid var(--tgui--outline)", background: "var(--tgui--secondary_bg_color)",
              color: "var(--tgui--text_color)", font: "inherit",
            }}
          >
            <option value="">Все события</option>
            {page.availableTypes.map((available) => (
              <option value={available} key={available}>
                {describeAuditEvent({ type: available, payload: {} }).title}
              </option>
            ))}
          </select>
          <select
            value={actor}
            onChange={(e) => {
              setOffset(0);
              setActor(e.target.value);
            }}
            style={{
              width: "100%", marginTop: 8, padding: "8px 10px", borderRadius: 8,
              border: "1px solid var(--tgui--outline)", background: "var(--tgui--secondary_bg_color)",
              color: "var(--tgui--text_color)", font: "inherit",
            }}
          >
            <option value="">Все люди</option>
            {page.availableActors.map((available) => (
              <option value={String(available.id)} key={available.id}>
                {available.displayName}
              </option>
            ))}
          </select>
          <div style={{ marginTop: 8, color: "var(--tgui--hint_color)", fontSize: 12.5 }}>
            {page.total === 0 ? "пусто" : `${page.offset + 1}–${shown} из ${page.total}`}
          </div>
        </CardShell>

        {page.events.length === 0 ? (
          <Placeholder description="Событий пока нет." />
        ) : (
          page.events.map((event) => <JournalEventCard event={event} key={event.id} />)
        )}

        <CardShell>
          <div style={{ display: "flex", gap: 8 }}>
            <Button size="s" mode="gray" stretched disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              ← Новее
            </Button>
            <Button size="s" mode="gray" stretched disabled={shown >= page.total} onClick={() => setOffset(offset + PAGE)}>
              Старее →
            </Button>
          </div>
        </CardShell>
      </CardStack>
    </Section>
  );
}
