import { useRef, useState } from "react";
import { Button, Section, Select, Spinner } from "@telegram-apps/telegram-ui";
import {
  apiClient,
  type Employee,
  type RosterImportPreview,
  type RosterPersonResolution,
} from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";
import { readCsvFile, type CsvEncoding } from "../../lib/csv-encoding";
import { withNotifyNotice } from "../../lib/shift";

/** Everything the confirm step needs, held together so a stale piece can't be applied. */
export interface RosterImportState {
  fileName: string;
  csv: string;
  encoding: CsvEncoding;
  preview: RosterImportPreview;
  resolutions: RosterPersonResolution[];
  /** Explicitly confirmed «заменить то, что уже стоит в этом периоде». */
  overwrite: boolean;
  busy: boolean;
  error: string | null;
}

/** An exact name match becomes a rename (keeping the person's Telegram link); the rest are new. */
export function initialResolutions(preview: RosterImportPreview): RosterPersonResolution[] {
  return preview.people.map((person) =>
    person.suggestedEmployeeId == null
      ? { csvName: person.csvName, action: "create" }
      : { csvName: person.csvName, action: "rename", employeeId: person.suggestedEmployeeId },
  );
}

/**
 * Why «Применить» is blocked, or null when it isn't. A period that already holds
 * entries is not an error — it just has to be confirmed, because applying replaces
 * what is there.
 */
export function importBlocker(state: Pick<RosterImportState, "preview" | "overwrite" | "resolutions">): string | null {
  if (state.preview.existingCount > 0 && !state.overwrite) {
    return `За этот период уже есть ${pluralRecords(state.preview.existingCount)} — отметь «перезаписать»`;
  }
  const ids = state.resolutions
    .filter((r): r is Extract<RosterPersonResolution, { action: "rename" }> => r.action === "rename")
    .map((r) => r.employeeId);
  if (new Set(ids).size !== ids.length) return "Один сотрудник выбран для нескольких строк";
  return null;
}

/** "1 запись" / "2 записи" / "5 записей". */
export function pluralRecords(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} записей`;
  if (mod10 === 1) return `${count} запись`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} записи`;
  return `${count} записей`;
}

/** "01.06.2026 — 30.06.2026", the way the file itself writes dates. */
export function formatPeriod(from: string, to: string): string {
  const ru = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
  return `${ru(from)} — ${ru(to)}`;
}

/** The month around `today`, as the [from, to] the export button defaults to. */
export function monthRangeOf(today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay)}` };
}

/** The one-line result of a finished import, for the success notice. */
export function summaryLine(summary: {
  entriesInserted: number;
  entriesDeleted: number;
  cellsPreserved: number;
  employeesCreated: number;
  swapsExpired?: number;
  unknowns?: { name: string; date: string; code: string }[];
}): string {
  const parts = [`добавлено ${pluralRecords(summary.entriesInserted)}`];
  if (summary.entriesDeleted > 0) parts.push(`заменено ${pluralRecords(summary.entriesDeleted)}`);
  if (summary.cellsPreserved > 0) parts.push(`не тронуто ${pluralRecords(summary.cellsPreserved)}`);
  if (summary.employeesCreated > 0) parts.push(`новых сотрудников — ${summary.employeesCreated}`);
  const line = `CSV загружен: ${parts.join(", ")}`;
  // Unreadable cells no longer stop the import, so the count has to travel with the
  // success notice — otherwise «загружено» is the last thing said about a file that
  // put question marks in the grid.
  const unreadable = summary.unknowns?.length ?? 0;
  const withUnknowns = unreadable > 0
    ? `${line}. ⚠ Не понял ${unreadable} ${unreadable === 1 ? "клетку" : "клеток"} — они стоят со знаком «?»`
    : line;
  // Replacing a month can invalidate swaps people were still waiting on. They get
  // told in chat; the admin who caused it should see it here rather than find out
  // from the person asking why their request says «Истекло».
  const expired = summary.swapsExpired ?? 0;
  return expired > 0
    ? `${withUnknowns}. ⚠ ${expired === 1 ? "1 заявка на обмен стала неактуальной" : `${expired} заявок на обмен стали неактуальны`} — обеим сторонам написали`
    : withUnknowns;
}

interface Props {
  /** Active workers, offered as rename targets in the reconciliation list. */
  employees: Employee[];
  /** Today, ISO — the month the export button defaults to. */
  today: string;
  onError: (message: string | null) => void;
  onNotice: (message: string) => void;
  /** Reload the screen's data after entries and people changed underneath it. */
  onImported: () => void | Promise<void>;
  /** Back to the day view — without it, opening this screen by mistake traps you. */
  onClose: () => void;
}

/**
 * «График файлом» (admin, mobile): the same guarded CSV flow as the desktop
 * console, rebuilt for a phone — pick a file, read what was decoded, fix the
 * ФИО mapping in a scrolling list, confirm, apply.
 *
 * The reconciliation list is the reason this is a full screen and not a dialog:
 * a real roster is 26 rows, each needing its own «создать нового / это вот он»
 * decision, and that never fits in a popup.
 */
export function AdminRosterCsv({ employees, today, onError, onNotice, onImported, onClose }: Props) {
  const [state, setState] = useState<RosterImportState | null>(null);
  const [exporting, setExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function pickFile(file: File) {
    onError(null);
    if (file.size > 1_000_000) {
      onError("Файл больше 1 МБ — загрузи один месяц");
      return;
    }
    try {
      // NOT file.text(): that assumes UTF-8, and Excel still writes windows-1251.
      // Mojibake ФИО match nobody, so the import would duplicate the whole team.
      const { text: csv, encoding } = await readCsvFile(file);
      const preview = await apiClient.previewRosterImport(csv);
      setState({
        fileName: file.name,
        csv,
        encoding,
        preview,
        resolutions: initialResolutions(preview),
        overwrite: false,
        busy: false,
        error: null,
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Не удалось прочитать CSV");
    }
  }

  function changeResolution(index: number, value: string) {
    setState((current) => {
      if (!current) return current;
      const person = current.preview.people[index];
      if (!person) return current;
      const resolutions = [...current.resolutions];
      resolutions[index] =
        value === "create"
          ? { csvName: person.csvName, action: "create" }
          : { csvName: person.csvName, action: "rename", employeeId: Number(value) };
      return { ...current, resolutions, error: null };
    });
  }

  async function apply() {
    if (!state) return;
    const blocker = importBlocker(state);
    if (blocker) {
      setState({ ...state, error: blocker });
      return;
    }
    setState({ ...state, busy: true, error: null });
    let summary;
    try {
      summary = await apiClient.applyRosterImport(state.csv, state.resolutions, state.overwrite);
    } catch (err) {
      setState((current) =>
        current ? { ...current, busy: false, error: err instanceof Error ? err.message : "Не удалось применить CSV" } : current,
      );
      return;
    }
    // Импорт уже прошёл — панель закрывается и успех говорится безусловно. Отказ
    // ниже (перечитать неделю и список сотрудников) — это другая беда: местное
    // поле ошибки к этому моменту уже не существует (`setState(null)` только что
    // его убрал), поэтому идёт через `onError`, а не теряется молча.
    setState(null);
    onNotice(withNotifyNotice(summaryLine(summary), summary.notified));
    try {
      await onImported();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Импорт прошёл, но не удалось обновить список — обновите страницу");
    }
  }

  async function exportCsv() {
    onError(null);
    setExporting(true);
    try {
      const { from, to } = monthRangeOf(today);
      const csv = await apiClient.getRosterCsv(from, to);
      // Leading BOM so Excel reads UTF-8 (Cyrillic) correctly.
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `roster-${from}_${to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onNotice(`Выгружен график за ${formatPeriod(from, to)}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Не удалось выгрузить CSV");
    } finally {
      setExporting(false);
    }
  }

  if (state) {
    const blocker = importBlocker(state);
    return (
      <Section header="Проверь, прежде чем применять">
        <CardStack>
          <CardShell>
            <div style={{ fontWeight: 600 }}>{state.fileName}</div>
            <div style={{ color: "var(--tg-theme-hint-color)", fontSize: 13, marginTop: 4 }}>
              {formatPeriod(state.preview.from, state.preview.to)} · {state.preview.people.length} сотрудников ·{" "}
              {pluralRecords(state.preview.entryCount)}
            </div>
            <div style={{ color: "var(--tg-theme-hint-color)", fontSize: 13, marginTop: 8 }}>
              База не меняется, пока не нажмёшь «Применить». Импорт идёт целиком, одной операцией.
            </div>
            {state.encoding === "windows-1251" && (
              <div style={{ color: "var(--tg-theme-hint-color)", fontSize: 13, marginTop: 8 }}>
                Файл в кодировке windows-1251 (так сохраняет Excel) — прочитал правильно, но глянь ФИО ниже.
              </div>
            )}
            {state.preview.unknownsMessage && (
              // A warning, not a blocker: the month still imports and these cells
              // land as «?», visible in the grid until somebody fixes the file.
              <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13, marginTop: 8, lineHeight: 1.45 }}>
                ⚠ {state.preview.unknownsMessage}
              </div>
            )}
            {state.preview.preservedCount > 0 && (
              <div style={{ color: "var(--tg-theme-hint-color)", fontSize: 13, marginTop: 8 }}>
                Клеток «?» — {state.preview.preservedCount}: работа в выходной, своё время, две записи в один день. Их
                импорт не тронет.
              </div>
            )}
          </CardShell>

          {state.preview.existingCount > 0 && (
            <CardShell>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, lineHeight: 1.4 }}>
                <input
                  type="checkbox"
                  checked={state.overwrite}
                  disabled={state.busy}
                  style={{ marginTop: 3, flex: "none" }}
                  onChange={(event) =>
                    setState((current) => (current ? { ...current, overwrite: event.target.checked, error: null } : current))
                  }
                />
                <span>
                  За этот период уже есть <b>{pluralRecords(state.preview.existingCount)}</b>. Перезаписать — старые
                  записи периода будут удалены и заменены содержимым файла.
                </span>
              </label>
            </CardShell>
          )}

          <CardShell>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Кто есть кто</div>
            {state.preview.people.map((person, index) => {
              const resolution = state.resolutions[index]!;
              return (
                <div key={`${person.csvName}-${index}`} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 14, marginBottom: 4 }}>{person.csvName}</div>
                  <Select
                    value={resolution.action === "create" ? "create" : String(resolution.employeeId)}
                    disabled={state.busy}
                    onChange={(event) => changeResolution(index, event.target.value)}
                  >
                    <option value="create">＋ Создать нового</option>
                    {employees.map((employee) => (
                      <option value={employee.id} key={employee.id}>
                        ↔ {employee.displayName}
                      </option>
                    ))}
                  </Select>
                </div>
              );
            })}
          </CardShell>

          {state.error && (
            <CardShell>
              <div style={{ color: "var(--tg-theme-destructive-text-color, #e53935)", fontSize: 14 }}>{state.error}</div>
            </CardShell>
          )}

          <CardShell>
            <div style={{ display: "flex", gap: 8 }}>
              <Button size="s" mode="gray" stretched disabled={state.busy} onClick={() => setState(null)}>
                Отмена
              </Button>
              <Button
                size="s"
                mode="filled"
                stretched
                loading={state.busy}
                disabled={state.busy || blocker !== null}
                onClick={() => void apply()}
              >
                {state.overwrite ? "Перезаписать" : "Применить"}
              </Button>
            </div>
            {blocker && (
              <div style={{ color: "var(--tg-theme-hint-color)", fontSize: 13, marginTop: 8 }}>{blocker}</div>
            )}
          </CardShell>
        </CardStack>
      </Section>
    );
  }

  return (
    <Section header="График файлом">
      <CardStack>
        <CardShell>
          <div style={{ color: "var(--tg-theme-hint-color)", fontSize: 13, marginBottom: 8 }}>
            Матрица «ФИО × даты» — та же, что открывается в Excel. Выгрузи текущий месяц, поправь и загрузи обратно.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button size="s" mode="gray" stretched onClick={() => fileInput.current?.click()}>
              ⬆ Загрузить
            </Button>
            <Button size="s" mode="filled" stretched loading={exporting} disabled={exporting} onClick={() => void exportCsv()}>
              ⬇ Выгрузить
            </Button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void pickFile(file);
            }}
          />
        </CardShell>
        {exporting && (
          <CardShell>
            <Spinner size="s" />
          </CardShell>
        )}
        <CardShell>
          <Button size="s" mode="gray" stretched onClick={onClose}>
            ← Назад к расписанию
          </Button>
        </CardShell>
      </CardStack>
    </Section>
  );
}
