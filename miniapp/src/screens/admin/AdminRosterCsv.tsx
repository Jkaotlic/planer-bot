import { useRef, useState } from "react";
import { pluralRecords, readCsvFile, rosterImportSummaryLine, type CsvEncoding } from "@planer/shared";
import { Spinner } from "@telegram-apps/telegram-ui";
import {
  apiClient,
  type Employee,
  type RosterImportPreview,
  type RosterPersonResolution,
} from "../../api/client";
import { withNotifyNotice } from "../../lib/shift";
import { ActionButton, Card, CheckRow, Group, Hint, SelectField } from "../../ui";

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
    onNotice(withNotifyNotice(rosterImportSummaryLine(summary), summary.notified));
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
      <Group header="Проверь, прежде чем применять">
        <Card>
          <div style={{ fontWeight: 600, fontSize: "var(--app-text-body)", overflowWrap: "anywhere" }}>{state.fileName}</div>
          <Hint>
            {formatPeriod(state.preview.from, state.preview.to)} · {state.preview.people.length} сотрудников ·{" "}
            {pluralRecords(state.preview.entryCount)}
          </Hint>
          <Hint>База не меняется, пока не нажмёшь «Применить». Импорт идёт целиком, одной операцией.</Hint>
          {state.encoding === "windows-1251" && (
            <Hint>Файл в кодировке windows-1251 (так сохраняет Excel) — прочитал правильно, но глянь ФИО ниже.</Hint>
          )}
          {state.preview.unknownsMessage && (
            // A warning, not a blocker: the month still imports and these cells
            // land as «?», visible in the grid until somebody fixes the file.
            <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)", lineHeight: 1.45 }}>
              ⚠ {state.preview.unknownsMessage}
            </div>
          )}
          {state.preview.preservedCount > 0 && (
            <Hint>
              Клеток «?» — {state.preview.preservedCount}: работа в выходной, своё время, две записи в один день. Их
              импорт не тронет.
            </Hint>
          )}
        </Card>

        {state.preview.existingCount > 0 && (
          <Card>
            <CheckRow
              checked={state.overwrite}
              disabled={state.busy}
              onChange={(next) => setState((current) => (current ? { ...current, overwrite: next, error: null } : current))}
              label={
                <>
                  За этот период уже есть <b>{pluralRecords(state.preview.existingCount)}</b>. Перезаписать — старые
                  записи периода будут удалены и заменены содержимым файла.
                </>
              }
            />
          </Card>
        )}

        <Card>
          <div style={{ fontWeight: 600, fontSize: "var(--app-text-body)" }}>Кто есть кто</div>
          {state.preview.people.map((person, index) => {
            const resolution = state.resolutions[index]!;
            return (
              // Имя — обычным текстом, а не серой подписью поля: по нему сверяют
              // файл с командой, и оно главное в строке.
              <div key={`${person.csvName}-${index}`} style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                <div style={{ fontSize: "var(--app-text-body)", overflowWrap: "anywhere" }}>{person.csvName}</div>
                <SelectField
                  stretched
                  aria-label={person.csvName}
                  value={resolution.action === "create" ? "create" : String(resolution.employeeId)}
                  disabled={state.busy}
                  onChange={(value) => changeResolution(index, value)}
                >
                  <option value="create">＋ Создать нового</option>
                  {employees.map((employee) => (
                    <option value={employee.id} key={employee.id}>
                      ↔ {employee.displayName}
                    </option>
                  ))}
                </SelectField>
              </div>
            );
          })}
        </Card>

        {state.error && (
          <Card>
            <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-body)" }}>{state.error}</div>
          </Card>
        )}

        <Card>
          <div style={{ display: "flex", gap: 8 }}>
            <ActionButton stretched disabled={state.busy} onClick={() => setState(null)}>
              Отмена
            </ActionButton>
            {/* Единственная primary: «Применить» меняет базу, остальное здесь — выход. */}
            <ActionButton
              kind="primary"
              stretched
              loading={state.busy}
              disabled={state.busy || blocker !== null}
              onClick={() => void apply()}
            >
              {state.overwrite ? "Перезаписать" : "Применить"}
            </ActionButton>
          </div>
          {blocker && <Hint>{blocker}</Hint>}
        </Card>
      </Group>
    );
  }

  return (
    <>
      <div style={{ alignSelf: "flex-start" }}>
        <ActionButton kind="quiet" onClick={onClose}>
          ← Назад к расписанию
        </ActionButton>
      </div>
      <Group header="График файлом">
        <Card>
          <Hint>
            Матрица «ФИО × даты» — та же, что открывается в Excel. Выгрузи текущий месяц, поправь и загрузи обратно.
          </Hint>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <ActionButton stretched onClick={() => fileInput.current?.click()}>
              ⬆ Загрузить
            </ActionButton>
            {/* primary — выгрузка: она безопасна, а загрузка ведёт на шаг проверки. */}
            <ActionButton kind="primary" stretched loading={exporting} disabled={exporting} onClick={() => void exportCsv()}>
              ⬇ Выгрузить
            </ActionButton>
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
        </Card>
        {exporting && (
          <Card>
            <Spinner size="s" />
          </Card>
        )}
      </Group>
    </>
  );
}
