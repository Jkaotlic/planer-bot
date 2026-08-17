import { useEffect, useState } from "react";
import { Button, Placeholder, SegmentedControl, Section, Spinner } from "@telegram-apps/telegram-ui";
import { formatAuditMoment } from "@planer/shared";
import { apiClient, type BugReportRow } from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";
import { ScreenScroll } from "../../components/ScreenScroll";

/**
 * «Баги» (admin): список того, что работники нажали «🐞 Проблема» и написали.
 *
 * Ради этого экрана и заводилась таблица `bug_reports` — в чате багрепорт
 * тонет за сутки среди остальной переписки, здесь он остаётся, пока кто-то
 * не отметит «Разобрал». Отметка обратима — тем же узором, что «Собрали,
 * закрыть» у сборов: неверный тап не теряет запись, а просто возвращает её
 * в список открытых.
 */
export function AdminBugs() {
  const [status, setStatus] = useState<"open" | "all">("open");
  const [reports, setReports] = useState<BugReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by «Повторить» — без него после ошибки перечитать список нечем. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setReports(null);
    setError(null);
    apiClient
      .getBugReports(status)
      .then((rows) => {
        if (!cancelled) setReports(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить багрепорты");
      });
    return () => {
      cancelled = true;
    };
  }, [status, attempt]);

  async function handleToggle(id: number, resolved: boolean) {
    // Оптимистично не трогаем список: сервер сам решает, что считать
    // «разобрано», а вторая карточка того же статуса не должна мигать между
    // правкой и перечитыванием.
    await apiClient.resolveBugReport(id, resolved);
    setAttempt((n) => n + 1);
  }

  return (
    <ScreenScroll>
      <Section header="Баги">
        <CardStack>
          <CardShell>
            <SegmentedControl>
              <SegmentedControl.Item selected={status === "open"} onClick={() => setStatus("open")}>
                Новые
              </SegmentedControl.Item>
              <SegmentedControl.Item selected={status === "all"} onClick={() => setStatus("all")}>
                Все
              </SegmentedControl.Item>
            </SegmentedControl>
          </CardShell>

          {error && (
            <CardShell>
              <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div>
              <Button size="s" mode="gray" stretched style={{ marginTop: 8 }} onClick={() => setAttempt((n) => n + 1)}>
                Повторить
              </Button>
            </CardShell>
          )}

          {!error && !reports && (
            <CardShell>
              <div style={{ display: "flex", justifyContent: "center", padding: 12 }}>
                <Spinner size="m" />
              </div>
            </CardShell>
          )}

          {!error && reports && reports.length === 0 && (
            <Placeholder description={status === "open" ? "Открытых багрепортов нет." : "Багрепортов пока не было."} />
          )}

          {!error && reports?.map((report) => <BugReportCard key={report.id} report={report} onToggle={handleToggle} />)}
        </CardStack>
      </Section>
    </ScreenScroll>
  );
}

function BugReportCard({ report, onToggle }: { report: BugReportRow; onToggle: (id: number, resolved: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolved = report.resolvedAt != null;

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      await onToggle(report.id, !resolved);
    } catch (err) {
      // Список не перечитался — карточка остаётся в прежнем состоянии, и это
      // видно и без ошибки текстом, но без неё непонятно, почему тап не подействовал.
      setError(err instanceof Error ? err.message : "Не удалось сохранить отметку");
    } finally {
      setBusy(false);
    }
  }

  return (
    <CardShell>
      <div style={{ color: "var(--tgui--hint_color)", fontSize: 12.5 }}>
        {report.authorName} · {formatAuditMoment(report.createdAt)}
      </div>
      <div style={{ marginTop: 4, fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {report.text}
      </div>
      {resolved && (
        <div style={{ marginTop: 6, color: "var(--tgui--hint_color)", fontSize: 12.5 }}>
          Разобрал {report.resolvedByName ?? "кто-то"} · {formatAuditMoment(report.resolvedAt!)}
        </div>
      )}
      {error && (
        <div style={{ marginTop: 6, color: "var(--tgui--destructive_text_color)", fontSize: 12.5 }}>{error}</div>
      )}
      <Button size="s" mode={resolved ? "gray" : "bezeled"} stretched loading={busy} disabled={busy} style={{ marginTop: 8 }} onClick={() => void handleClick()}>
        {resolved ? "Вернуть в работу" : "Разобрал"}
      </Button>
    </CardShell>
  );
}
