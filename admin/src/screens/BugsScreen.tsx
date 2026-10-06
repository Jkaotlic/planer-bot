import { useEffect, useState } from "react";
import { formatAuditMoment } from "@planer/shared";
import { apiClient, type BugReportRow } from "../api/client";
import { Segmented } from "../components/Segmented";
import { routeAuthError, useAuthRequired } from "../auth-required";

const BUG_FILTERS = [
  { key: "open", label: "Новые" },
  { key: "all", label: "Все" },
] as const;

/**
 * «Баги» (admin): список того, что работники нажали «🐞 Проблема» и написали.
 *
 * Ради этого экрана и заводилась таблица `bug_reports` — в чате багрепорт
 * тонет за сутки среди остальной переписки, здесь он остаётся, пока кто-то
 * не отметит «Разобрал». Отметка обратима — тем же узором, что «Собрали,
 * закрыть» у сборов: неверный тап не теряет запись, а просто возвращает её
 * в список открытых.
 *
 * Поведение перенесено целиком из мини-апповского `AdminBugs`, вёрстка —
 * консольная, как у «Анонсов».
 */
export function BugsScreen() {
  const onAuthRequired = useAuthRequired();
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
        if (routeAuthError(err, onAuthRequired)) return;
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
    <div className="employees-screen">
      <div className="employees-header">
        <h2 className="employees-title">Баги</h2>
      </div>

      <div className="segmented-row">
        <Segmented
          aria-label="Какие баги показывать"
          options={BUG_FILTERS}
          value={status}
          onChange={setStatus}
        />
      </div>

      {error && (
        <div>
          <div className="employees-error">{error}</div>
          <button type="button" className="btn btn-secondary" onClick={() => setAttempt((n) => n + 1)}>
            Повторить
          </button>
        </div>
      )}

      {!error && !reports && <div className="employees-empty">Загрузка…</div>}

      {!error && reports && reports.length === 0 && (
        <div className="empty-state">{status === "open" ? "Открытых багрепортов нет." : "Багрепортов пока не было."}</div>
      )}

      {!error && reports?.map((report) => <BugReportCard key={report.id} report={report} onToggle={handleToggle} />)}
    </div>
  );
}

function BugReportCard({
  report,
  onToggle,
}: {
  report: BugReportRow;
  onToggle: (id: number, resolved: boolean) => Promise<void>;
}) {
  const onAuthRequired = useAuthRequired();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolved = report.resolvedAt != null;

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      await onToggle(report.id, !resolved);
    } catch (err) {
      if (routeAuthError(err, onAuthRequired)) return;
      // Список не перечитался — карточка остаётся в прежнем состоянии, и это
      // видно и без ошибки текстом, но без неё непонятно, почему тап не подействовал.
      setError(err instanceof Error ? err.message : "Не удалось сохранить отметку");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bug-card">
      <div className="bug-card-meta">
        {report.authorName} · {formatAuditMoment(report.createdAt)}
      </div>
      <div className="bug-card-text">{report.text}</div>
      {resolved && (
        <div className="bug-card-meta">
          Разобрал {report.resolvedByName ?? "кто-то"} · {formatAuditMoment(report.resolvedAt!)}
        </div>
      )}
      {error && <div className="employees-error">{error}</div>}
      <button type="button" className={`btn ${resolved ? "btn-secondary" : "btn-primary"}`} disabled={busy} onClick={() => void handleClick()}>
        {resolved ? "Вернуть в работу" : "Разобрал"}
      </button>
    </div>
  );
}
