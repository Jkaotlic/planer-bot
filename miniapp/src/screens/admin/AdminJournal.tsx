import { useEffect, useState } from "react";
import { Button, Input, Placeholder, SegmentedControl, Section, Spinner } from "@telegram-apps/telegram-ui";
import { apiClient, type JournalPage, type ShiftCountsReport } from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";
import { ScreenScroll } from "../../components/ScreenScroll";
import { initialsOf, personPalette } from "../../lib/people";

/** What each audit type is called in the log, in words rather than in code. */
const TYPE_LABELS: Record<string, string> = {
  entry_created: "Добавлена запись",
  entry_updated: "Изменена запись",
  entry_deleted: "Удалена запись",
  distribution_applied: "Смены распределены честно",
  employee_reordered: "Изменён порядок людей",
  template_roles_changed: "Изменено «кто что может»",
  template_rotation_changed: "Изменена очередь",
  reminder_undeliverable: "Напоминание не дошло — бот заблокирован",
  roster_import: "Загрузка графика из CSV",
  swap_proposed: "Предложен обмен",
  swap_accepted: "Обмен состоялся",
  swap_declined: "Обмен отклонён",
  swap_cancelled: "Обмен отменён",
  swap_expired: "Обмен стал неактуален",
  swap_auto_cancelled: "Обмен отменён автоматически",
  employee_updated: "Изменены данные работника",
  employee_archived: "Работник архивирован",
  employee_restored: "Работник восстановлен",
  employee_admin_changed: "Изменены права админа",
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
export function monthRangeOf(today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
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

function ShiftCounts({ today }: { today: string }) {
  const initial = monthRangeOf(today);
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

  return (
    <Section header="Кто сколько отдежурил">
      <CardStack>
        <CardShell>
          {/* Stacked, not side by side: two native date fields sharing a phone's
              width clip their own year — «07/01/2» — and the year is the part you
              check when picking a period. */}
          <Input header="С" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input header="По" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button size="s" mode="filled" stretched loading={busy} disabled={busy} style={{ marginTop: 6 }} onClick={() => void load()}>
            Показать
          </Button>
          {error && (
            <div style={{ marginTop: 8, color: "var(--tgui--destructive_text_color)", fontSize: 13 }}>{error}</div>
          )}
        </CardShell>

        {report && report.kinds.length === 0 && <Placeholder description="За этот период смен не было." />}

        {report?.rows
          .filter((row) => row.total > 0)
          .map((row) => {
            const palette = personPalette(row.employeeId);
            return (
              <CardShell key={row.employeeId}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      flex: "none", display: "grid", placeContent: "center", width: 30, height: 30,
                      borderRadius: 999, fontSize: 11, fontWeight: 700, background: palette.bg, color: palette.fg,
                    }}
                  >
                    {initialsOf(row.displayName)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 15 }}>{row.displayName}</span>
                  <span style={{ flex: "none", fontWeight: 700 }}>{row.total}</span>
                </div>
                <div style={{ marginTop: 6, color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.5 }}>
                  {report.kinds
                    .filter((kind) => row.byKind[kind])
                    .map((kind) => `${kind} ${row.byKind[kind]}`)
                    .join(" · ")}
                </div>
              </CardShell>
            );
          })}

        {report && report.rows.every((row) => row.total === 0) && report.kinds.length > 0 && (
          <Placeholder description="Ни у кого нет смен за этот период." />
        )}
      </CardStack>
    </Section>
  );
}

const PAGE = 30;

function History() {
  const [page, setPage] = useState<JournalPage | null>(null);
  const [type, setType] = useState("");
  const [actor, setActor] = useState("");
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getJournal({ types: type ? [type] : [], actor: actor ? Number(actor) : undefined, limit: PAGE, offset })
      .then((next) => {
        if (!cancelled) setPage(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить журнал");
      });
    return () => {
      cancelled = true;
    };
  }, [type, actor, offset]);

  if (error) {
    return (
      <Section header="Кто что менял">
        <div style={{ padding: 16, color: "var(--tgui--destructive_text_color)", fontSize: 14 }}>{error}</div>
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
                {typeLabel(available)}
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
          page.events.map((event) => (
            <CardShell key={event.id}>
              <div style={{ fontWeight: 600, fontSize: 14.5 }}>{typeLabel(event.type)}</div>
              <div style={{ marginTop: 4, color: "var(--tgui--hint_color)", fontSize: 13 }}>
                {event.actorName ?? "система"} · {formatMoment(event.createdAt)}
              </div>
            </CardShell>
          ))
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
