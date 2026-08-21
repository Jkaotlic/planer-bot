import { useEffect, useState } from "react";
import { exactSchedulePalette, filterPeople } from "@planer/shared";
import { Button, Placeholder, Section, Spinner } from "@telegram-apps/telegram-ui";
import { apiClient, type Employee, type TemplateQueue, type TemplateRolesView } from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";
import { PersonSearch } from "../../components/PersonSearch";
import { initialsOf, personPalette } from "../../lib/people";
import { useEntryPalette } from "../../categories";
import { withError, withoutError } from "../../lib/error-map";

/**
 * "все (26)" or "5 из 26". An empty pool is not "nobody" — it is an unconfigured
 * preset, and it means everyone. Saying so is the whole difference between the
 * screen reading as a whitelist and reading as a blacklist.
 */
export function poolSummary(poolSize: number, total: number): string {
  return poolSize === 0 ? `все (${total})` : `${poolSize} из ${total}`;
}

export function toggleId(ids: readonly number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
}

export function togglePreference(
  preference: Readonly<Record<number, number>>,
  id: number,
): Record<number, number> {
  const next = { ...preference };
  if (next[id]) delete next[id];
  else next[id] = 1;
  return next;
}

/**
 * «Кто что может» (admin, mobile): the pool and the preferences for each kind of
 * shift. One kind open at a time — twenty-six rows of two toggles is already the
 * whole screen, and two kinds open at once would just be scrolling.
 */
export function AdminShiftKinds({
  employees,
  onClose,
}: {
  employees: Employee[];
  /** Back to the day view — without it this screen is a dead end. */
  onClose: () => void;
}) {
  const [kinds, setKinds] = useState<TemplateRolesView[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  /**
   * Отказ по id вида смены, а не один на экран. Экран выше окна даже свёрнутым
   * (замер на 390×844: высота 970, последняя карточка на y=747), а развёрнутая
   * карточка добавляет по строке на каждого активного — отказ, нарисованный
   * родителем над `ScreenScroll`, для нажавшего в такой карточке невидим.
   */
  const [errors, setErrors] = useState<ReadonlyMap<number, string>>(new Map());
  /** Упавшая начальная загрузка: без неё показывать нечего, и «Повторить» — единственный выход. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const active = employees.filter((employee) => employee.isActive);

  // Запрос принадлежит открытой карточке, а не экрану: без сброса здесь
  // закрыть карточку A с непустым поиском и открыть B значило бы, что B
  // открывается уже отфильтрованной — под запрос, который в контексте B
  // никто не вводил. Mirrors console's `toggleOpen`.
  function toggleOpen(templateId: number) {
    setOpenId((current) => (current === templateId ? null : templateId));
    setQuery("");
  }

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    apiClient
      .getTemplateRoles()
      .then((next) => {
        if (!cancelled) setKinds(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Не удалось загрузить виды смен");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function save(kind: TemplateRolesView, patch: Partial<TemplateRolesView>) {
    const next = { ...kind, ...patch };
    setKinds((current) => current?.map((item) => (item.templateId === kind.templateId ? next : item)) ?? current);
    setBusyId(kind.templateId);
    setErrors((prev) => withoutError(prev, kind.templateId));
    try {
      await apiClient.saveTemplateRoles(next.templateId, next.pool, next.preference);
    } catch (err) {
      // Put the server's version back rather than leaving a lie on screen.
      setKinds(await apiClient.getTemplateRoles().catch(() => null));
      setErrors((prev) => withError(prev, kind.templateId, err instanceof Error ? err.message : "Не удалось сохранить"));
    } finally {
      setBusyId(null);
    }
  }

  async function saveRotation(kind: TemplateRolesView, unit: "day" | "week") {
    setBusyId(kind.templateId);
    setErrors((prev) => withoutError(prev, kind.templateId));
    try {
      await apiClient.setRotationUnit(kind.templateId, unit);
    } catch (err) {
      setErrors((prev) => withError(prev, kind.templateId, err instanceof Error ? err.message : "Не удалось сохранить очередь"));
    } finally {
      setBusyId(null);
    }
  }

  if (loadError) {
    return (
      <Section header="Кто что может">
        <CardStack>
          <CardShell>
            <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 14 }}>{loadError}</div>
            <Button size="s" mode="gray" stretched style={{ marginTop: 8 }} onClick={() => setAttempt((n) => n + 1)}>
              Повторить
            </Button>
          </CardShell>
        </CardStack>
      </Section>
    );
  }

  if (!kinds) {
    return (
      <Section header="Кто что может">
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <Spinner size="m" />
        </div>
      </Section>
    );
  }

  return (
    <Section header="Кто что может">
      <CardStack>
        <CardShell>
          <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>
            Пустой список допущенных значит «все» — никого не нужно исключать, просто не отмечай.
            «Любит» не перебивает справедливость: решает только ничью, когда смен этого вида поровну.
          </div>
        </CardShell>

        {kinds.map((kind) => (
          <KindCard
            key={kind.templateId}
            kind={kind}
            employees={active}
            query={query}
            onQueryChange={setQuery}
            open={openId === kind.templateId}
            busy={busyId === kind.templateId}
            error={errors.get(kind.templateId)}
            onToggleOpen={() => toggleOpen(kind.templateId)}
            onChange={(patch) => void save(kind, patch)}
            onRotationUnit={(unit) => saveRotation(kind, unit)}
          />
        ))}

        {active.length === 0 && <Placeholder description="Сначала добавь работников." />}

        <CardShell>
          <Button size="s" mode="gray" stretched onClick={onClose}>
            ← Назад к расписанию
          </Button>
        </CardShell>
      </CardStack>
    </Section>
  );
}

function KindCard({
  kind,
  employees,
  query,
  onQueryChange,
  open,
  busy,
  error,
  onToggleOpen,
  onChange,
  onRotationUnit,
}: {
  kind: TemplateRolesView;
  employees: Employee[];
  query: string;
  onQueryChange: (value: string) => void;
  open: boolean;
  busy: boolean;
  /** Отказ на последнее действие именно в этой карточке. */
  error?: string;
  onToggleOpen: () => void;
  onChange: (patch: Partial<TemplateRolesView>) => void;
  onRotationUnit: (unit: "day" | "week") => Promise<void>;
}) {
  const palette = useEntryPalette({ templateId: kind.templateId, category: kind.category }, [
    { id: kind.templateId, accent: kind.accent },
  ]);
  // The very letter the week grid draws for this kind, not the first letter of its
  // name — otherwise all four duties read «Д» here and «Т»/«П»/«ВА»/«07» there.
  const code = exactSchedulePalette(kind.accent, kind.category)?.code ?? kind.name.slice(0, 1);
  const preferred = Object.keys(kind.preference).length;
  const [queue, setQueue] = useState<TemplateQueue | null>(null);

  // History, not settings — fetched when the card opens and whenever the pool
  // changes, since the pool decides who is in the queue at all.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiClient
      .getTemplateQueue(kind.templateId)
      .then((next) => {
        if (!cancelled) setQueue(next);
      })
      .catch(() => {
        if (!cancelled) setQueue(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, kind.templateId, kind.pool.length]);

  /**
   * The select is controlled off `queue`, and `queue` is only re-read when the
   * card opens — so saving alone left React putting the old value straight back:
   * the admin picked «по неделям», the control snapped to «по дням», and the
   * setting looked like it hadn't taken even though the server had already
   * written it. Show the choice at once, then re-read the queue: the «Следующие:
   * …» labels are folded into words server-side by this very unit, so they are
   * stale until the whole queue comes back.
   */
  async function changeUnit(unit: "day" | "week") {
    setQueue((prev) => (prev ? { ...prev, rotationUnit: unit } : prev));
    await onRotationUnit(unit);
    const fresh = await apiClient.getTemplateQueue(kind.templateId).catch(() => null);
    if (fresh) setQueue(fresh);
  }

  return (
    <CardShell>
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%",
          background: "transparent", border: "none", padding: 0, font: "inherit",
          color: "var(--tgui--text_color)", textAlign: "left", cursor: "pointer",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            flex: "none", display: "grid", placeContent: "center", width: 30, height: 30,
            borderRadius: 8, fontSize: 13, fontWeight: 700, background: palette.bg, color: palette.fg,
          }}
        >
          {code}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontWeight: 600, fontSize: 15 }}>{kind.name}</span>
          <span style={{ display: "block", color: "var(--tgui--hint_color)", fontSize: 12.5 }}>
            допущены: {poolSummary(kind.pool.length, employees.length)}
            {preferred > 0 && ` · любят: ${preferred}`}
          </span>
        </span>
        <span style={{ flex: "none", color: "var(--tgui--hint_color)" }}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--tgui--outline)" }}>
          <div style={{ padding: "10px 0 2px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--tgui--hint_color)" }}>
              Очередь идёт
              <select
                value={queue?.rotationUnit ?? "day"}
                disabled={busy || !queue}
                onChange={(e) => void changeUnit(e.target.value as "day" | "week")}
                style={{
                  padding: "5px 8px", borderRadius: 8, border: "1px solid var(--tgui--outline)",
                  background: "var(--tgui--secondary_bg_color)", color: "var(--tgui--text_color)", font: "inherit",
                }}
              >
                <option value="day">по дням</option>
                <option value="week">по неделям</option>
              </select>
            </label>
            {queue && queue.queue.length > 0 ? (
              <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.45 }}>
                Следующие: {queue.queue.slice(0, 3).map((turn) => turn.label).join(" → ")}
                <br />
                <span style={{ color: "var(--tgui--hint_color)", fontSize: 12 }}>
                  Бот только подсказывает — ставишь смену ты сам.
                </span>
              </p>
            ) : (
              <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--tgui--hint_color)" }}>
                Очередь появится, когда в допущенных кто-нибудь будет.
              </p>
            )}
          </div>

          <PersonSearch value={query} onChange={onQueryChange} count={employees.length} disabled={busy} />

          <div
            style={{
              display: "grid", gridTemplateColumns: "1fr 64px 56px", gap: 6, padding: "10px 0 6px",
              color: "var(--tgui--hint_color)", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase",
            }}
          >
            <span>Работник</span>
            <span style={{ justifySelf: "center" }}>Допущен</span>
            <span style={{ justifySelf: "center" }}>Любит</span>
          </div>
          {/* Фильтруется только отрисовка строк. `kind.pool` и `kind.preference`
              (кнопка «Сбросить на «все»» и счётчики выше) считаются и
              сохраняются из полного `employees` — они не должны зависеть от
              того, что набрано в поиске. */}
          {filterPeople(employees, query).map((employee) => {
            const colours = personPalette(employee.id);
            return (
              <label
                key={employee.id}
                style={{
                  display: "grid", gridTemplateColumns: "1fr 64px 56px", gap: 6, alignItems: "center",
                  padding: "7px 0", borderTop: "1px solid var(--tgui--outline)",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, fontSize: 14 }}>
                  <span
                    style={{
                      flex: "none", display: "grid", placeContent: "center", width: 26, height: 26,
                      borderRadius: 999, fontSize: 10.5, fontWeight: 700,
                      background: colours.bg, color: colours.fg,
                    }}
                  >
                    {initialsOf(employee.displayName)}
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {employee.displayName}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={kind.pool.includes(employee.id)}
                  disabled={busy}
                  style={{ justifySelf: "center", width: 20, height: 20 }}
                  aria-label={`${employee.displayName}: допущен к «${kind.name}»`}
                  onChange={() => onChange({ pool: toggleId(kind.pool, employee.id) })}
                />
                <input
                  type="checkbox"
                  checked={Boolean(kind.preference[employee.id])}
                  disabled={busy}
                  style={{ justifySelf: "center", width: 20, height: 20 }}
                  aria-label={`${employee.displayName}: любит «${kind.name}»`}
                  onChange={() => onChange({ preference: togglePreference(kind.preference, employee.id) })}
                />
              </label>
            );
          })}
          {kind.pool.length > 0 && (
            <Button size="s" mode="gray" stretched disabled={busy} style={{ marginTop: 12 }} onClick={() => onChange({ pool: [] })}>
              Сбросить на «все»
            </Button>
          )}
        </div>
      )}
      {/* Свёрнутую карточку отказ тоже касается: сохранение могло не дойти уже
          после того, как её закрыли. */}
      {error && (
        <div style={{ marginTop: 8, color: "var(--tgui--destructive_text_color)", fontSize: 13.5, lineHeight: 1.35 }}>
          {error}
        </div>
      )}
    </CardShell>
  );
}
